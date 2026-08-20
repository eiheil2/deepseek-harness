/** The Web package refuses to pack absent or incomplete Vite output. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyWebDist } from './verify-web-dist.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-web-prepack-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('verifyWebDist', () => {
  it('requires both index.html and an emitted asset', () => {
    expect(() => { verifyWebDist(root) }).toThrow(/missing .*index.html/)

    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>\n')
    expect(() => { verifyWebDist(root) }).toThrow(/contains no built asset/)

    mkdirSync(join(root, 'dist', 'assets'))
    writeFileSync(join(root, 'dist', 'assets', 'index.js'), 'export {}\n')
    expect(() => { verifyWebDist(root) }).not.toThrow()
  })
})
