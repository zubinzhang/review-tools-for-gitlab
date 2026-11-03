import path from 'node:path';
import fs from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { glob } from 'glob';
import { rimraf } from 'rimraf';
import { root } from './utils/run_utils.mjs';

/**
 * Transforms dependencies using ES6 modules to CommonJS. Otherwise, we can't require
 * these dependencies from CommonJS modules without using dynamic imports.
 *
 * This is necessary only for integration tests, not production
 *
 * This fixes the following error:
 *
 * Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported.
 * Instead change the require .. to a dynamic import() which is available in all CommonJS modules.
 */

// why: These packages have multiple files with relative imports between each other
//      (and deep entry points, e.g. uuid/dist/esm/*), so we transform every .js file
//      in place (keeping the directory layout) rather than bundling into a single file.
async function transpileFile(sourceFile, targetFile) {
  const sourceText = await fs.readFile(sourceFile, 'utf8');
  const { code } = await esbuild.transform(sourceText, {
    loader: 'js',
    format: 'cjs',
    target: 'node18.17',
    sourcefile: sourceFile,
  });
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.writeFile(targetFile, code);
}

async function processModule(module) {
  try {
    const sourceDir = path.join(root, 'node_modules', module);
    const targetDir = path.join(root, 'dist-desktop/node_modules', module);

    // remove the original module
    await rimraf(targetDir);

    // transpile every ES module .js file to CommonJS, keeping the directory layout
    const jsFiles = await glob('**/*.js', { cwd: sourceDir, nodir: true });
    await Promise.all(
      jsFiles.map(relativeFile =>
        transpileFile(path.join(sourceDir, relativeFile), path.join(targetDir, relativeFile)),
      ),
    );

    // copy package.json, but remove the ES module mark (type: module)
    const packageJsonPath = path.join(sourceDir, 'package.json');
    const destPackageJsonPath = path.join(targetDir, 'package.json');

    await fs.access(packageJsonPath); // check that file exists

    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    delete packageJson.type;
    await fs.writeFile(destPackageJsonPath, JSON.stringify(packageJson, null, 2));

    console.log(`Successfully transpiled ES module ${module} to CommonJS`);
  } catch (error) {
    console.error(`Error when transpiling ES module ${module} to CommonJS`);
    throw error;
  }
}

async function main() {
  const modules = ['@anycable/core', 'nanoevents', 'uuid'];

  await Promise.all(modules.map(module => processModule(module)));
}

main();
