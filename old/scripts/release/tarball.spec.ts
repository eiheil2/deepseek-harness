/** Packed release artifacts are bound to the checkout's complete family plan. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { releaseFamily, tarballName, type ReleaseMember } from './families.ts'
import { PUBLISH_ORDER_FILE, verifyPackedRelease } from './tarball.ts'

let root: string
let packed: string

/** Write one release member manifest under the temporary checkout. */
function writeMember(directory: string, name: string): ReleaseMember {
  const member = { directory, name, version: '0.0.1', manifest: { name, version: '0.0.1' } } as const
  mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, directory, 'package.json'), `${JSON.stringify(member.manifest)}\n`)
  return member
}

/** Create a minimal npm-style tarball under its expected filename. */
function writeTarball(member: ReleaseMember, identity: { name: string; version: string } = member): void {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-release-tarball-'))
  try {
    mkdirSync(join(staging, 'package', 'lib'), { recursive: true })
    writeFileSync(join(staging, 'package', 'package.json'), `${JSON.stringify(identity)}\n`)
    writeFileSync(join(staging, 'package', 'lib', 'index.js'), 'export {}\n')
    const result = spawnSync('tar', ['-czf', join(packed, tarballName(member)), '-C', staging, 'package'], {
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`tar fixture failed: ${result.stderr}`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-release-checkout-'))
  packed = join(root, 'packed')
  mkdirSync(packed)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('verifyPackedRelease', () => {
  it('accepts exactly the complete family in checkout publish order', () => {
    const alpha = writeMember('packages/core/alpha', '@deepseek-ai/dsh-alpha')
    const beta = writeMember('apps/beta', '@deepseek-ai/dsh-beta')
    writeTarball(alpha)
    writeTarball(beta)
    writeFileSync(join(packed, PUBLISH_ORDER_FILE), `${tarballName(alpha)}\n${tarballName(beta)}\n`)

    expect(verifyPackedRelease(releaseFamily('dsh'), root, packed).map(entry => entry.member.name)).toEqual([
      alpha.name,
      beta.name,
    ])
  })

  it('rejects unsafe, incomplete, extra, and identity-mismatched artifacts', () => {
    const alpha = writeMember('packages/core/alpha', '@deepseek-ai/dsh-alpha')
    writeTarball(alpha)

    writeFileSync(join(packed, PUBLISH_ORDER_FILE), '../outside.tgz\n')
    expect(() => verifyPackedRelease(releaseFamily('dsh'), root, packed)).toThrow(/unsafe filename/)

    writeFileSync(join(packed, PUBLISH_ORDER_FILE), '')
    expect(() => verifyPackedRelease(releaseFamily('dsh'), root, packed)).toThrow(/order does not match/)

    writeFileSync(join(packed, PUBLISH_ORDER_FILE), `${tarballName(alpha)}\n${tarballName(alpha)}\n`)
    expect(() => verifyPackedRelease(releaseFamily('dsh'), root, packed)).toThrow(/repeats/)

    writeFileSync(join(packed, PUBLISH_ORDER_FILE), `${tarballName(alpha)}\n`)
    writeFileSync(join(packed, 'extra.tgz'), 'not a tarball')
    expect(() => verifyPackedRelease(releaseFamily('dsh'), root, packed)).toThrow(/tarballs do not match/)
    rmSync(join(packed, 'extra.tgz'))

    writeTarball(alpha, { name: '@deepseek-ai/dsh-other', version: alpha.version })
    expect(() => verifyPackedRelease(releaseFamily('dsh'), root, packed)).toThrow(/declares .* expected/)
  })
})
