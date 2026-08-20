import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

function tool(name: string, description = name): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } }
}

function utf8JsonBytes(tools: readonly ToolSchema[]): number {
  return new TextEncoder().encode(JSON.stringify(tools)).byteLength
}

async function mount(maxAggregateToolSchemaBytes: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { maxAggregateToolSchemaBytes })
  return ctx
}

describe('SystemPrompt aggregate tool-schema budget', () => {
  it('accepts a complete schema set below the configured byte budget', async () => {
    const schemas = [tool('alpha')]
    const ctx = await mount(utf8JsonBytes(schemas) + 1)
    ctx.systemPrompt.tools(() => ({ schemas }))

    await expect(ctx.systemPrompt.assemble()).resolves.toMatchObject({ tools: schemas })
  })

  it('accepts a complete schema set exactly at the configured byte budget', async () => {
    const schemas = [tool('alpha'), tool('bravo')]
    const ctx = await mount(utf8JsonBytes(schemas))
    ctx.systemPrompt.tools(() => ({ schemas }))

    await expect(ctx.systemPrompt.assemble()).resolves.toMatchObject({ tools: schemas })
  })

  it('rejects multiple schemas whose aggregate JSON exceeds the budget', async () => {
    const schemas = [tool('alpha'), tool('bravo')]
    const bytes = utf8JsonBytes(schemas)
    const ctx = await mount(bytes - 1)
    ctx.systemPrompt.tools(() => ({ schemas }))

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(
      `aggregate tool schemas require ${bytes} UTF-8 bytes, exceeding maxAggregateToolSchemaBytes=${bytes - 1}`,
    )
  })

  it('measures multibyte descriptions as UTF-8 rather than UTF-16 code units', async () => {
    const schemas = [tool('alpha', '工具')]
    const utf8Bytes = utf8JsonBytes(schemas)
    expect(utf8Bytes).toBeGreaterThan(JSON.stringify(schemas).length)
    const ctx = await mount(utf8Bytes - 1)
    ctx.systemPrompt.tools(() => ({ schemas }))

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(`require ${utf8Bytes} UTF-8 bytes`)
  })

  it('enforces the budget after assemble listeners add tools', async () => {
    const registered = [tool('alpha')]
    const appended = tool('bravo', 'added by waterfall')
    const complete = [...registered, appended]
    const ctx = await mount(utf8JsonBytes(complete) - 1)
    ctx.systemPrompt.tools(() => ({ schemas: registered }))
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      assembly.tools.push(appended)
      return next()
    })

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('exceeding maxAggregateToolSchemaBytes')
  })

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid maxAggregateToolSchemaBytes=%s at plugin load',
    async (maxAggregateToolSchemaBytes) => {
      await expect(new Context().plugin(SystemPrompt, { maxAggregateToolSchemaBytes }))
        .rejects.toThrow(/maxAggregateToolSchemaBytes|invalid|expected/i)
    },
  )
})
