import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as CredentialsInvariant from '@deepseek-ai/dsh-credentials/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { LocalCredentialProvider } from '../src/index.ts'

// The atomic write is the gated asynchronous hold point inside a queued
// write; gating it makes the dispose-versus-queued-write race fully
// deterministic. The lock helper passes through so the gated operation still
// runs inside its real acquire/release cycle.
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  let gate: Promise<void> = Promise.resolve()
  let entered = () => {}
  return {
    ...actual,
    writeFileAtomic: vi.fn(async (...args: Parameters<typeof actual.writeFileAtomic>) => {
      const currentGate = gate
      entered()
      await currentGate
      await actual.writeFileAtomic(...args)
    }),
    __setGate: (next: Promise<void>, onEntered: () => void = () => {}) => {
      gate = next
      entered = onEntered
    },
  }
})

async function setGate(next: Promise<void>, onEntered?: () => void): Promise<void> {
  const mocked = await import('@deepseek-ai/dsh-atomic-write') as unknown as {
    __setGate: (next: Promise<void>, onEntered?: () => void) => void
  }
  mocked.__setGate(next, onEntered)
}

const KEY = credentialRef('DSH_CRED_DRAIN_A')
const OTHER = credentialRef('DSH_CRED_DRAIN_B')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await setGate(Promise.resolve())
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('write-drain teardown', () => {
  it('lands an in-flight write without publishing after its service starts disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-drain-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, '.credentials.yaml')
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CredentialsInvariant)
    const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
    await fiber
    const service = ctx.credentials
    const seen: string[] = []
    ctx.on('credentials/updated', ref => void seen.push(ref))

    let release!: () => void
    let markEntered!: () => void
    const entered = new Promise<void>((resolveEntered) => {
      markEntered = resolveEntered
    })
    await setGate(new Promise<void>((resolveGate) => {
      release = resolveGate
    }), markEntered)
    const first = service.set(KEY, 'one')
    const firstResolves = expect(first).resolves.toBeUndefined()
    await entered
    // Attach the rejection handler up front: the queued write fails while the
    // drain is still awaited, before any later `await expect` could run.
    const secondRejects = expect(service.set(OTHER, 'two')).rejects.toThrow(/disposed before the queued/)
    const disposal = fiber.dispose()
    // Let Cordis start every disposer so the provider closes before the
    // already-entered atomic write is released.
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn))
    release()
    await disposal

    await firstResolves
    await secondRejects
    expect(await readFile(path, 'utf8')).toBe(`${KEY}: one\n`)
    expect(await service.resolve(KEY)).toEqual({ value: 'one', source: 'file' })
    expect(await service.resolve(OTHER)).toBeUndefined()
    expect(seen).toEqual([])
  })
})
