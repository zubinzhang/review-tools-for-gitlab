import path from 'node:path';
import fs from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { copy } from 'fs-extra/esm';
import * as glob from 'glob';
import { ENVIRONMENTS } from '../constants.mjs';
import { root, run } from './run_utils.mjs';
import { createDesktopPackageJson } from './packages.mjs';
import { writeThirdPartyNotices } from './third_party_notices.mjs';
import {
  isBinaryBuild,
  downloadLspBinaries,
  hostVsceTarget,
  packagedBinaryName,
  VSCE_TARGET_TO_BINARY,
} from './lsp_binaries.mjs';
import {
  prepareWebviews,
  generateAssets,
  writePackageJson,
  commonJobs,
  copyStaticProjectFiles,
  lspBasePath,
} from './common_jobs.mjs';

const desktopWebviews = {
  vue3: ['issuable'],
};

const packagedLsDir = path.join(root, 'dist-desktop/assets/language-server');

// The VSIX ships exactly one binary; the packaged name differs per platform
// (gitlab-lsp vs gitlab-lsp.exe), so an overwrite alone would leave the other behind.
function removePackagedLspBinaries() {
  glob
    .sync(path.join(packagedLsDir, 'gitlab-lsp*'), { windowsPathsNoEscape: true })
    .forEach(file => fs.rmSync(file));
}

export async function copyLspBinary(target) {
  removePackagedLspBinaries();

  const downloadedBinDir = await downloadLspBinaries();
  // Fixed destination name so the extension never has to detect platform/arch at runtime
  await copy(
    path.join(downloadedBinDir, VSCE_TARGET_TO_BINARY[target]),
    path.join(packagedLsDir, packagedBinaryName(target)),
  );
}

export async function copyLanguageServerAssets() {
  if (isBinaryBuild()) {
    const binDir = await downloadLspBinaries();
    // Allowlist excludes the other platform binaries and published sourcemaps.
    const assets = ['tree-sitter.wasm', 'vendor', 'webviews'];
    return Promise.all([
      ...assets.map(asset =>
        copy(
          path.join(binDir, asset),
          path.join(root, 'dist-desktop/assets/language-server', asset),
        ),
      ),
      // Host binary keeps local builds debuggable; packaging swaps it per target
      copyLspBinary(hostVsceTarget()),
    ]);
  }

  const assets = glob.sync(
    [
      path.join(lspBasePath, 'rg?(.exe)'),
      path.join(lspBasePath, 'main-bundle-node.*'),
      path.join(lspBasePath, 'sandbox_worker.*'),
      path.join(lspBasePath, 'vendor/seccomp/*/apply-seccomp'),
    ],
    {
      windowsPathsNoEscape: true,
    },
  );
  const copyPromises = assets.map(asset =>
    copy(asset, path.join(`dist-desktop/assets/language-server`, asset.replace(lspBasePath, ''))),
  );
  return Promise.all(copyPromises);
}

export async function copyPendingJobAssets() {
  return copyFile(
    path.join(root, 'webviews/pendingjob.html'),
    path.join(root, `dist-desktop/webviews/pendingjob.html`),
  );
}

export async function compileSource() {
  await run('tsc', ['-p', root]);
}

export async function buildExtension(args = [], signal) {
  await run(
    'esbuild',
    [
      path.join(root, 'src/desktop/review_extension.js'),
      '--bundle',
      '--outfile=dist-desktop/extension.js',
      '--external:vscode',
      '--platform=node',
      '--target=node18.17',
      '--sourcemap',
      '--metafile=dist-desktop/extension.meta.json',
      '--loader:.html=text',
      `--inject:${path.join(root, 'scripts/utils/import_meta_url_shim.js')}`,
      '--define:import.meta.url=importMetaUrl',
      ...args,
    ],
    { cancelSignal: signal },
  );
}

export async function checkAndBuildExtension(args = []) {
  await compileSource();
  await buildExtension(args);
}

/**
 * Copy a directory using native OS utils
 * (not using NodeJS `fs` for performance reasons when copying large node_modules dirs)
 */
async function copyDirectory(sourcePath, destPath) {
  if (process.platform === 'win32') {
    // robocopy copies the contents of source into dest (does NOT create an additional subdirectory named after source)
    // So ensure we handle that by making a more specific destPath
    const sourceDir = path.basename(sourcePath);
    const fullDestPath = path.join(destPath, sourceDir);

    try {
      const reduceOutputVerbosityFlags = ['/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'];
      const copySubdirectoriesRecursivelyFlag = '/E';
      await run('robocopy', [
        sourcePath,
        fullDestPath,
        copySubdirectoriesRecursivelyFlag,
        ...reduceOutputVerbosityFlags,
      ]);
    } catch (error) {
      // robocopy exits with:
      // 0 - no files copied (no change/no files)
      // 1 - files copied successfully
      // 2+ - some errors occurred
      if (error.exitCode === 1 || error.code === 1) {
        console.log(
          'robocopy exited with code 1. This is not an error, everything copied correctly.',
        );
        return;
      }
      throw error;
    }
  } else {
    await run('cp', ['-R', sourcePath, destPath]);
  }
}

export async function copyNodeModules() {
  await copyDirectory(path.join(root, 'node_modules'), path.join(root, 'dist-desktop'));
}

export async function copyWalkthroughs() {
  await copyDirectory(path.join(root, 'walkthroughs'), path.join(root, 'dist-desktop'));
}

export function watchWebviews(signal) {
  const targets = Object.keys(desktopWebviews);
  targets.forEach(async target => {
    desktopWebviews[target].forEach(webview => {
      const dirpath = path.join(root, `webviews/${target}/dist/${webview}`);
      if (!fs.existsSync(dirpath)) fs.mkdirSync(dirpath, { recursive: true });
      fs.symlinkSync(dirpath, path.join(root, `dist-desktop/webviews/${webview}`));
    });
    await run('npm', ['run', '--prefix', path.join(root, `webviews/${target}`), 'watch'], {
      cancelSignal: signal,
    });
  });
}

export async function buildDesktop() {
  const packageJson = createDesktopPackageJson();

  await commonJobs(ENVIRONMENTS.DESKTOP);

  await Promise.all([
    prepareWebviews(desktopWebviews, ENVIRONMENTS.DESKTOP),
    copyStaticProjectFiles(ENVIRONMENTS.DESKTOP),
    checkAndBuildExtension(['--minify']),
    generateAssets(packageJson, ENVIRONMENTS.DESKTOP, false),
  ]);

  // we need to wait for `tsc` to compile so we can replace package.json
  await writePackageJson(packageJson, ENVIRONMENTS.DESKTOP);
  await writeThirdPartyNotices(root);
}

export async function watchDesktop(signal) {
  const packageJson = createDesktopPackageJson();
  await compileSource();
  await writePackageJson(packageJson, ENVIRONMENTS.DESKTOP);
  copyStaticProjectFiles(ENVIRONMENTS.DESKTOP);
  await buildExtension(['--watch'], signal);
}

export async function buildPackage(options, isPreReleaseBuild, target) {
  const args = ['--no-dependencies'];
  if (target) {
    args.push('--target', target);
  }
  if (isPreReleaseBuild) {
    args.push('--pre-release');
  }
  await run('vsce', ['package', ...args], options);
}
