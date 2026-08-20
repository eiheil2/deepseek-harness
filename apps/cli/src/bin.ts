#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'
import type { RecoveryOptions } from './profile-boot.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const invocation = parseDshArgs(process.argv.slice(2), readVersion())

const SAFE_MODE_ENV = 'DSH_SAFE_MODE_MODE'
const SAFE_MODE_IDS_ENV = 'DSH_SAFE_MODE_IDS'
const SAFE_MODE_DISABLED_ENV = 'DSH_SAFE_MODE_DISABLED'

/** Read a bounded, launcher-generated recovery request from the environment. */
function readRecoveryOptions(): RecoveryOptions | undefined {
  const mode = process.env[SAFE_MODE_ENV]
  if (mode !== 'culprit' && mode !== 'all') return undefined
  if (mode === 'all') return { mode }
  let raw: unknown
  try {
    raw = JSON.parse(process.env[SAFE_MODE_IDS_ENV] ?? '[]')
  } catch {
    return { mode, disabledEntryIds: [] }
  }
  if (!Array.isArray(raw)) return { mode, disabledEntryIds: [] }
  const ids = raw
    .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(id))
    .slice(0, 32)
  return { mode, disabledEntryIds: ids }
}

/** Whether a failed boot reached the Loader/plugin lifecycle rather than config parsing. */
function isPluginStartupFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}\n${String(error.cause ?? '')}` : String(error)
  return /(plugin tree failed to load|failed to (?:import|apply) loader entry|did not activate|loader fibers failed)/i.test(text)
}

/** Restart this exact CLI invocation with a bounded safe-mode request. */
function restartInSafeMode(mode: 'culprit' | 'all', ids: readonly string[]): void {
  const env = {
    ...process.env,
    [SAFE_MODE_ENV]: mode,
    [SAFE_MODE_IDS_ENV]: JSON.stringify(ids),
  }
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  if (child.error !== undefined) throw child.error
  process.exitCode = child.status ?? 1
}

/** Boot once, then restart at most twice with culprit/all-plugin recovery. */
async function runProfileWithRecovery(
  profile: string,
  patches: readonly string[],
  args: readonly string[],
): Promise<void> {
  const { ProfileStartupError, runProfile } = await import('./profile-boot.ts')
  const recovery = readRecoveryOptions()
  try {
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile,
      patchFiles: patches,
      args,
      ...(recovery === undefined ? {} : { recovery }),
    })
  } catch (error) {
    if (process.env[SAFE_MODE_DISABLED_ENV] === '1'
      || !isPluginStartupFailure(error)
      || recovery?.mode === 'all') throw error
    const profileError = error instanceof ProfileStartupError ? error : undefined
    const failures = profileError?.plugins ?? []
    const ids = failures.map(failure => failure.id)
    const nextMode = recovery?.mode === 'culprit' ? 'all' : ids.length > 0 ? 'culprit' : 'all'
    const suspected = failures.length > 0
      ? failures.map(failure => `${failure.id} (${failure.name})`).join(', ')
      : 'unable to identify a single entry'
    process.stderr.write(`dsh: plugin startup failure detected (${suspected}); restarting in ${nextMode} safe mode\n`)
    restartInSafeMode(nextMode, ids)
  }
}

switch (invocation.mode) {
  case 'profile': {
    await runProfileWithRecovery(invocation.profile, invocation.patches, invocation.args)
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
