import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (name: string): string => readFileSync(resolve(root, name), 'utf8')

describe('production installers', () => {
  it.each(['install.sh', 'install.ps1'])('installs only the published production package (%s)', (name) => {
    const source = read(name)
    expect(source).toContain('@deepseek-ai/dsh')
    expect(source).toContain('--omit=dev')
    expect(source).toContain('--no-audit')
    expect(source).not.toMatch(/git\s+clone|pnpm\s+install|npm\s+pack(?:\s|$)/i)
    expect(source).not.toMatch(/\.agents|node_modules|experiments|debug\s+record/i)
  })

  it('requires an HTTPS registry on both native installers', () => {
    expect(read('install.sh')).toContain('registry must use HTTPS')
    expect(read('install.ps1')).toContain('registry must use HTTPS')
  })

  it('recognizes both POSIX and Windows npm shim layouts from a POSIX shell', () => {
    const source = read('install.sh')
    expect(source).toContain('$BIN_DIR/dsh')
    expect(source).toContain('$PREFIX/dsh.cmd')
  })

  it('keeps Windows and macOS launchers as argument-forwarding wrappers', () => {
    expect(read('install.cmd')).toContain('install.ps1')
    expect(read('install.cmd')).toContain('%*')
    expect(read('install.command')).toContain('install.sh')
    expect(read('install.command')).toContain('"$@"')
  })
})
