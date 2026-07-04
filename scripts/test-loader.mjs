// ESM resolver hook for `node --test`, registered via test-register.mjs.
//
// The app is built by Next's bundler, so source uses two conveniences the bare
// Node resolver doesn't handle on its own:
//   • `@/...` path aliases  (tsconfig "paths")
//   • extensionless imports (`./types` rather than `./types.ts`)
// This hook rewrites both so test files can import the real lib modules unchanged.
// Type stripping itself is handled natively by Node 24.
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()

function addExtension(absPath) {
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath
  for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs']) {
    if (fs.existsSync(absPath + ext)) return absPath + ext
  }
  // Directory import (e.g. `@/lib/mappers`) — resolve to its index file, as
  // the bundler would.
  if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
    for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs']) {
      const idx = path.join(absPath, 'index' + ext)
      if (fs.existsSync(idx)) return idx
    }
  }
  return absPath
}

export async function resolve(specifier, context, nextResolve) {
  // `@/...` is a bare alias the default resolver can't handle — rewrite it to an
  // absolute path (adding the source extension Next would otherwise infer).
  if (specifier.startsWith('@/')) {
    const abs = addExtension(path.resolve(ROOT, specifier.slice(2)))
    return nextResolve(pathToFileURL(abs).href, context)
  }

  // For everything else, let the default resolver try first — only relative
  // extensionless imports (e.g. `./types`) need our help, and only when they fail.
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (
      err?.code === 'ERR_MODULE_NOT_FOUND' &&
      specifier.startsWith('.') &&
      context.parentURL?.startsWith('file:')
    ) {
      const abs = addExtension(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
      return nextResolve(pathToFileURL(abs).href, context)
    }
    throw err
  }
}
