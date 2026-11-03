import path from 'node:path';
import { root } from './utils/run_utils.mjs';
import { buildDesktop, buildPackage } from './utils/desktop_jobs.mjs';

await buildDesktop();
await buildPackage({ cwd: path.resolve(root, 'dist-desktop') }, false);
