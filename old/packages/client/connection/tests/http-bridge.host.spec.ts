import { EventEmitter, once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bridge } from '../src/http-bridge.ts'

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`did not settle within ${timeoutMs}ms`)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('HTTP bridge abort', () => {
  it('settles and cancels the response body when close races with backpressure', async () => {
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.export',
      method: 'GET',
      headers: {},
    })

    let writes = 0
    let ended = false
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writeHead() { return this },
      write(this: EventEmitter & { destroyed: boolean }) {
        writes += 1
        this.destroyed = true
        this.emit('close')
        return false
      },
      end() { ended = true; this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([writes])) },
      cancel() { cancelled = true },
    })
    const pending = bridge(request, response, {
      fetch: async () => new Response(body),
    })
    await settleWithin(pending, 100)
    expect(writes).toBe(1)
    expect(cancelled).toBe(true)
    expect(ended).toBe(false)
  })

  it('settles a real HTTP stream when the client closes before a buffered chunk', async () => {
    let cancelled = false
    let bridgeTask: Promise<void> | undefined
    const server = createServer((request, response) => {
      bridgeTask = bridge(request, response, {
        fetch: async () => new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
            setTimeout(() => { controller.enqueue(new Uint8Array([2])) }, 25)
          },
          cancel() { cancelled = true },
        })),
      })
    })

    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const { port } = server.address() as AddressInfo
      const clientClosed = new Promise<void>((resolve, reject) => {
        const request = httpRequest({ host: '127.0.0.1', port, path: '/api/session.export' })
        request.once('error', reject)
        request.once('response', (response) => {
          response.once('data', () => {
            response.destroy()
            resolve()
          })
        })
        request.end()
      })
      await settleWithin(clientClosed)
      if (bridgeTask === undefined) throw new Error('HTTP bridge did not start')
      await settleWithin(bridgeTask)
      expect(cancelled).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })
})
