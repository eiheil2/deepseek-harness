/** Release subprocesses execute Windows package-manager shims without open shell interpolation. */

import { describe, expect, it } from 'vitest'
import { releaseInvocation } from './process.ts'

describe('releaseInvocation', () => {
  it('keeps native tools direct and resolves Windows package-manager shims through ComSpec', () => {
    expect(releaseInvocation('tar', ['-tzf', 'a.tgz'], 'win32', 'C:\\Windows\\cmd.exe')).toEqual({
      command: 'tar',
      args: ['-tzf', 'a.tgz'],
    })
    expect(releaseInvocation('pnpm', ['--dir', 'path with spaces', 'pack'], 'win32', 'C:\\Windows\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', '"pnpm "--dir" "path with spaces" "pack""'],
      windowsVerbatimArguments: true,
    })
    expect(releaseInvocation('npm', ['install'], 'linux', undefined)).toEqual({ command: 'npm', args: ['install'] })
  })

  it('rejects command expansion syntax instead of interpolating it', () => {
    expect(() => { releaseInvocation('npm', ['publish', 'bad%PATH%.tgz'], 'win32', 'cmd.exe') }).toThrow(/unsafe/)
    expect(() => { releaseInvocation('pnpm', ['bad" & whoami'], 'win32', 'cmd.exe') }).toThrow(/unsafe/)
    expect(() => { releaseInvocation('npm', ['install'], 'win32', '') }).toThrow(/ComSpec/)
  })
})
