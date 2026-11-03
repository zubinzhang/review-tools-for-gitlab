// Injected into the desktop bundle by esbuild (see `buildExtension` in desktop_jobs.mjs).
// why: esbuild resolves ESM builds (e.g. OpenTelemetry 3.x `.mjs`) that call
//      `createRequire(import.meta.url)` at load time. The CJS output leaves
//      `import.meta` empty, so `import.meta.url` is defined as this export instead.
import { pathToFileURL } from 'node:url';

export const importMetaUrl = pathToFileURL(__filename).href;
