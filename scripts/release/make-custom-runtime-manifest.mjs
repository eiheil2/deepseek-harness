import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const [output, ...directories] = process.argv.slice(2)
if (output === undefined || directories.length === 0) {
  throw new Error('usage: make-custom-runtime-manifest.mjs <output> <packed-dir> [<packed-dir> ...]')
}

const root = resolve(process.cwd())
const packages = {}
// The tarball names are read from the pack outputs.  The package manifest is
// the source of truth; filenames alone are not reliable for scoped packages.
for (const directory of directories) {
  const absolute = resolve(root, directory)
  const filenames = readdirSync(absolute).filter(filename => filename.endsWith('.tgz')).sort()
  for (const filename of filenames) {
    const tarball = `${absolute}/${filename}`
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`${tarball} has no package name/version`)
    }
    if (packages[manifest.name] !== undefined) throw new Error(`duplicate package ${manifest.name}`)
    packages[manifest.name] = relative(resolve(dirname(output)), tarball).replaceAll('\\', '/')
  }
}

mkdirSync(dirname(resolve(output)), { recursive: true })
writeFileSync(resolve(output), `${JSON.stringify({ formatVersion: 1, packages }, null, 2)}\n`)
console.log(`custom runtime manifest: ${String(Object.keys(packages).length)} package tarballs`)
