/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StorageError } from '@deepseek-ai/dsh-storage'

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
    await fsyncDirectory(dirname(path), path)
  } catch (error) {
    await rm(tmp, { force: true })
    // Windows: replacing a read-only target fails with a bare EPERM from
    // rename (POSIX rename would succeed, and the target's read-only
    // attribute dies with the replaced file). Classify so callers get a
    // structured StorageError instead of a raw errno escaping the storage
    // taxonomy.
    if (error instanceof Error && 'code' in error
      && (error.code === 'EPERM' || error.code === 'EACCES')) {
      throw new StorageError('permission-denied', `cannot write "${path}": permission denied`, { cause: error })
    }
    throw error
  }
}

/**
 * fsync a directory so a just-renamed entry is crash-durable.
 * @param dirPath - the parent directory of the renamed entry.
 * @param filePath - (win32 only) the renamed file inside the directory.
 */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(dirPath: string, filePath?: string | null): Promise<void> {
  if (process.platform === 'win32') {
    // Windows workaround: a read-only ("r") directory handle fsync fails with
    // EPERM (verified on win32), so open the file read-write ("r+") instead —
    // fsyncing a file within the directory forces NTFS to flush the directory
    // entry. The file is freshly renamed here, so it exists and is writable by
    // the caller.
    if (filePath) {
      const handle = await open(filePath, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    return
  }
  const handle = await open(dirPath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
