/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable with plain Node.
 *
 * Every tarball the installed tree needs comes from `--from`, so the only
 * registry traffic is for external dependencies. That matters beyond hermetic
 * verification: the harness packages declare the vendored framework as a peer,
 * those packages live in another release sequence, and this job must not depend
 * on the registry already carrying versions that match — one pull request may
 * bump both families before either publishes — so a dsh verification passes the
 * vendored family's pack output too, while publishing only its own
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * What this proves is that `files` selected a complete payload and that the
 * published dependency ranges resolve. A workspace link or a stale `lib/` in the
 * checkout cannot stand in for a missing file here.
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseFamily, type ReleaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity, tarballFiles } from './tarball.ts'
import { verifyWebDist } from './verify-web-dist.ts'

/** One tarball supplied to the isolated consumer. */
interface PackedDependency {
  /** File URL written into the consumer manifest. */
  readonly url: string
  /** Version declared by the tarball. */
  readonly version: string
  /** Absolute tarball path used for payload verification. */
  readonly tarball: string
}

/**
 * Environment for the installed artifact: no host Node hooks, no host DeepSeek
 * Harness home, and no ambient npm user agent that would confuse npm.
 * @param consumerRoot - the throwaway consumer directory.
 * @returns The child environment.
 */
function consumerEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/**
 * Every packed tarball in the given directories, as `file:` dependency entries.
 *
 * The directories are read by their contents rather than a pack order file: a
 * directory here can hold tarballs packed only to satisfy a cross-sequence
 * dependency, which no release order describes.
 * @param directories - absolute directories holding packed tarballs.
 * @returns Package name to tarball file URL, and the version each carries.
 */
function packedDependencies(directories: readonly string[]): Map<string, PackedDependency> {
  const dependencies = new Map<string, PackedDependency>()
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      if (dependencies.has(name)) throw new Error(`${name} appears in more than one packed tarball`)
      dependencies.set(name, { url: pathToFileURL(tarball).href, version, tarball })
    }
  }
  return dependencies
}

/**
 * Require every checkout member of the selected family, at the checkout
 * version, and reapply its packed-payload policy before installation.
 * @param family - family selected by the verification workflow.
 * @param root - repository root whose manifests define the release.
 * @param packed - all local tarballs supplied to the consumer.
 * @returns Selected family members in deterministic discovery order.
 */
function verifyPackedFamilyMembers(
  family: ReleaseFamily,
  root: string,
  packed: ReadonlyMap<string, PackedDependency>,
): readonly string[] {
  const members = family.members(root)
  family.verifyVersions(members)
  for (const member of members) {
    const artifact = packed.get(member.name)
    if (artifact === undefined) throw new Error(`${member.name} is not among the packed tarballs`)
    if (artifact.version !== member.version) {
      throw new Error(`${member.name} packed version ${artifact.version}, expected ${member.version}`)
    }
    family.validatePayload(member, tarballFiles(artifact.tarball))
  }
  return members.map(member => member.name)
}

/**
 * Import every library package through its public root export.
 * @param consumerRoot - isolated installed consumer.
 * @param packageNames - verified family package names.
 * @param environment - sanitized child environment.
 */
function verifyLibraryImports(
  consumerRoot: string,
  packageNames: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  const program = `await Promise.all(${JSON.stringify(packageNames)}.map(name => import(name)))`
  capture(process.execPath, ['--input-type=module', '--eval', program], { cwd: consumerRoot, env: environment })
  console.log(`release verify-packed-install: imported ${String(packageNames.length)} public package entries`)
}

/**
 * Require the installed Web package to retain its entry and emitted assets.
 * @param consumerRoot - isolated installed consumer.
 */
function verifyInstalledWeb(consumerRoot: string): void {
  const packageRoot = join(consumerRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend')
  verifyWebDist(packageRoot)
  console.log('release verify-packed-install: installed Web frontend carries its entry and built assets')
}

/** Install every tarball under `--from` and drive the `--family` entry. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family <dsh|vendor> --from <packed directory> [--from ...]')
  }

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const packed = packedDependencies(values.from.map(directory => resolve(root, directory)))
  const familyPackages = verifyPackedFamilyMembers(family, root, packed)

  const consumerRoot = mkdtempSync(join(tmpdir(), `dsh-packed-${family.id}-`))
  try {
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `dsh-packed-install-${family.id}`,
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries([...packed].map(([name, entryPacked]) => [name, entryPacked.url])),
    }, null, 2)}\n`)

    const environment = consumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.size)} tarball(s) into ${consumerRoot}`)
    // Optional dependencies are omitted: the Landlock platform packages behind
    // them need a musl toolchain and one build per architecture, and a consumer
    // that cannot install them must still start — which is what optional means
    // here. Their entry package is a plain dependency of dsh-sandbox-local, so
    // its tarball is supplied through --from.
    capture('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--omit=optional'],
      { cwd: consumerRoot, env: environment })

    const entry = family.installedEntry
    if (entry === undefined) {
      verifyLibraryImports(consumerRoot, familyPackages, environment)
    } else {
      const expected = packed.get(entry.packageName)
      if (expected === undefined) throw new Error(`${entry.packageName} is not among the packed tarballs`)
      const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
      const version = capture(process.execPath, [bin, '--version'], { cwd: consumerRoot, env: environment })
      if (version !== expected.version) {
        throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expected.version}`)
      }
      console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)
      verifyInstalledWeb(consumerRoot)
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) main()
