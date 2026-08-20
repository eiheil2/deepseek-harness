/** Fail a Web frontend pack whose Vite output is missing or empty. */

import { globSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { isEntry } from './process.ts'

/**
 * Require the Vite entry and at least one emitted asset before packaging.
 * @param packageRoot - Web package directory containing `dist/`.
 */
export function verifyWebDist(packageRoot: string): void {
  const dist = resolve(packageRoot, 'dist')
  const index = resolve(dist, 'index.html')
  if (!lstatSync(index, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`web prepack: missing ${index}; run the Web build before packing`)
  }
  const assets = globSync('assets/**/*', { cwd: dist })
    .filter(path => !path.endsWith('.map') && lstatSync(resolve(dist, path)).isFile())
  if (assets.length === 0) throw new Error(`web prepack: ${dist} contains no built asset`)
}

if (isEntry(import.meta.url)) verifyWebDist(process.cwd())
