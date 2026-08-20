import { describe, expect, it } from 'vitest'
import {
  identifyStartupPluginFailures,
  ProfileStartupError,
} from '../src/profile-boot.ts'

describe('startup safe-mode diagnostics', () => {
  it('identifies configured entries named by a Loader activation failure', () => {
    const rows = new Map([
      ['base', { id: 'base', name: '@deepseek-ai/dsh-base' }],
      ['custom', { id: 'custom', name: 'file:///tmp/broken-plugin.mjs' }],
    ])
    const error = new Error(
      'dsh: plugin tree failed to load: failed to apply loader entry custom (file:///tmp/broken-plugin.mjs): boom',
    )
    expect(identifyStartupPluginFailures(error, rows)).toEqual([
      { id: 'custom', name: 'file:///tmp/broken-plugin.mjs' },
    ])
  })

  it('does not turn patch parsing failures into plugin recovery candidates', () => {
    const rows = new Map([
      ['custom', { id: 'custom', name: 'broken-plugin' }],
    ])
    expect(identifyStartupPluginFailures(new Error('dsh: failed to parse patches'), rows)).toEqual([])
  })

  it('retains the original boot rejection as the recovery error cause', () => {
    const original = new Error('plugin tree failed to load')
    const wrapped = new ProfileStartupError('plugin tree failed to load', original, [
      { id: 'custom', name: 'broken-plugin' },
    ])
    expect(wrapped.cause).toBe(original)
    expect(wrapped.plugins).toEqual([{ id: 'custom', name: 'broken-plugin' }])
  })
})
