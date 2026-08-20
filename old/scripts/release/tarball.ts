/**
 * Reading packed npm tarballs and the order file that accompanies them.
 *
 * The release steps after pack treat a directory of tarballs as the unit of
 * work, so they read what a tarball declares rather than what the checkout
 * currently says.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tarballName, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { capture } from './process.ts'

/** Name of the file recording the order in which a packed family uploads. */
export const PUBLISH_ORDER_FILE = 'publish-order.txt'

/** What a packed tarball calls itself. */
export interface PackedIdentity {
  /** Package name from the packed manifest. */
  readonly name: string
  /** Package version from the packed manifest. */
  readonly version: string
}

/** One packed member after its filename, manifest, and payload have been verified. */
export interface PackedReleaseMember {
  /** Source member this artifact must publish. */
  readonly member: ReleaseMember
  /** Safe basename recorded in `publish-order.txt`. */
  readonly filename: string
  /** Absolute path to the regular tarball file. */
  readonly tarball: string
}

/**
 * List a tarball's members.
 * @param tarball - absolute tarball path.
 * @returns Every path inside the archive.
 */
export function tarballFiles(tarball: string): string[] {
  return capture('tar', ['-tzf', tarball]).split(/\r?\n/).filter(line => line !== '')
}

/**
 * Read a packed tarball's own manifest.
 * @param tarball - absolute tarball path.
 * @returns The name and version the tarball declares.
 */
export function packedIdentity(tarball: string): PackedIdentity {
  const manifest: unknown = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (manifest === null || typeof manifest !== 'object') throw new Error(`${tarball} has no manifest`)
  const { name, version } = manifest as Record<string, unknown>
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error(`${tarball} manifest lacks name/version`)
  return { name, version }
}

/**
 * Read a packed directory's upload order.
 * @param directory - absolute path of a pack output directory.
 * @returns Tarball filenames in upload order.
 */
export function readPublishOrder(directory: string): string[] {
  return readFileSync(join(directory, PUBLISH_ORDER_FILE), 'utf8').split('\n').filter(line => line !== '')
}

/**
 * Verify that a packed directory is exactly one complete release family.
 *
 * This check runs again in the credential-bearing publish job, where neither
 * the downloaded artifact nor its order file is trusted. It rejects path
 * traversal, links, missing or extra tarballs, reordered members, stale
 * versions, and tarballs whose own manifest or payload disagrees with the
 * checkout's family plan.
 * @param family - family selected by the release workflow.
 * @param root - repository root whose manifests define the release.
 * @param directory - downloaded packed-artifact directory.
 * @returns Members and absolute tarball paths in required publish order.
 */
export function verifyPackedRelease(
  family: ReleaseFamily,
  root: string,
  directory: string,
): PackedReleaseMember[] {
  const members = family.members(root)
  family.verifyVersions(members)
  const plan = family.publishOrder(members).order
  if (plan.length !== members.length) {
    throw new Error(
      `release family ${family.id}: publish order covers ${String(plan.length)} of ${String(members.length)} members`,
    )
  }

  const order = readPublishOrder(directory)
  const seen = new Set<string>()
  for (const filename of order) {
    if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`${PUBLISH_ORDER_FILE} contains unsafe filename ${JSON.stringify(filename)}`)
    }
    if (seen.has(filename)) throw new Error(`${PUBLISH_ORDER_FILE} repeats ${filename}`)
    seen.add(filename)
  }

  const expected = plan.map(tarballName)
  if (order.length !== expected.length || order.some((filename, index) => filename !== expected[index])) {
    throw new Error(
      `packed release order does not match family ${family.id}`
      + `\nexpected:\n${expected.join('\n')}\nactual:\n${order.join('\n')}`,
    )
  }

  const packedFilenames = readdirSync(directory).filter(filename => filename.endsWith('.tgz')).sort()
  const expectedSorted = [...expected].sort()
  if (packedFilenames.length !== expectedSorted.length
    || packedFilenames.some((filename, index) => filename !== expectedSorted[index])) {
    throw new Error(
      `packed tarballs do not match family ${family.id}`
      + `\nexpected:\n${expectedSorted.join('\n')}\nactual:\n${packedFilenames.join('\n')}`,
    )
  }

  return plan.map((member, index) => {
    const filename = order[index]
    if (filename === undefined) throw new Error(`packed release has no artifact for ${member.name}`)
    const tarball = join(directory, filename)
    if (!lstatSync(tarball).isFile()) throw new Error(`${tarball} must be a regular file`)
    const identity = packedIdentity(tarball)
    if (identity.name !== member.name || identity.version !== member.version) {
      throw new Error(
        `${filename} declares ${identity.name}@${identity.version}, expected ${member.name}@${member.version}`,
      )
    }
    family.validatePayload(member, tarballFiles(tarball))
    return { member, filename, tarball }
  })
}
