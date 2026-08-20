/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one stack-safe image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  const pending: ContentBlock[] = []
  for (let index = content.length - 1; index >= 0; index--) pending.push(content[index] as ContentBlock)
  while (pending.length > 0) {
    const block = pending.pop()
    /* v8 ignore next -- the loop condition proves one block remains. */
    if (block === undefined) continue
    if (block.type === 'image') return true
    if (block.type === 'tool-result') {
      for (let index = block.content.length - 1; index >= 0; index--) {
        pending.push(block.content[index] as ContentBlock)
      }
    }
  }
  return false
}
