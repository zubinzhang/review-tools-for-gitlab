import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { root, run } from './run_utils.mjs';

export const isBinaryBuild = () => process.env.GITLAB_LSP_BINARY_BUILD === 'true';

export const VSCE_TARGET_TO_BINARY = {
  'darwin-arm64': 'gitlab-lsp-macos-arm64',
  'darwin-x64': 'gitlab-lsp-macos-x64',
  'linux-x64': 'gitlab-lsp-linux-x64',
  'linux-arm64': 'gitlab-lsp-linux-arm64',
  'win32-x64': 'gitlab-lsp-win-x64.exe',
  'win32-arm64': 'gitlab-lsp-win-arm64.exe',
};

export function hostVsceTarget() {
  const target = `${process.platform}-${process.arch}`;
  if (!VSCE_TARGET_TO_BINARY[target]) {
    throw new Error(
      `No compiled gitlab-lsp binary for host platform "${target}". Supported targets: ${Object.keys(
        VSCE_TARGET_TO_BINARY,
      ).join(', ')}.`,
    );
  }
  return target;
}

// Must match binaryName in src/desktop/language_server/desktop_language_client_factory.ts,
// which spawns the packaged binary under this fixed name
export const packagedBinaryName = target =>
  target.startsWith('win32') ? 'gitlab-lsp.exe' : 'gitlab-lsp';

export function resolveLspVersion() {
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf-8'));
  const version = lockfile.packages?.['node_modules/@gitlab-org/gitlab-lsp']?.version;
  if (!version) {
    throw new Error('Could not resolve @gitlab-org/gitlab-lsp version from package-lock.json.');
  }
  return version;
}

// Deterministic upload URL used by gitlab-lsp scripts/deploy.sh
const packageUrl = version =>
  `https://gitlab.com/api/v4/projects/gitlab-org%2Feditor-extensions%2Fgitlab-lsp/packages/generic/gitlab-language-server/${version}/gitlab-lsp-${version}.tar.gz`;

async function fetchTarball(url) {
  let response = await fetch(url);
  if (!response.ok && process.env.CI_JOB_TOKEN) {
    response = await fetch(url, { headers: { 'JOB-TOKEN': process.env.CI_JOB_TOKEN } });
  }
  if (!response.ok) {
    throw new Error(`Failed to download gitlab-lsp binaries from ${url}: HTTP ${response.status}`);
  }
  return response;
}

async function download(version) {
  const cacheDir = path.join(root, 'tmp', 'gitlab-lsp');
  // Tarball is created as `tar -czf ... ./bin`, so it extracts to a `bin` directory
  const binDir = path.join(cacheDir, version, 'bin');
  if (fs.existsSync(binDir)) {
    console.log(`Using cached gitlab-lsp binaries from ${binDir}`);
    return binDir;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const url = packageUrl(version);
  console.log(`Downloading gitlab-lsp binaries from ${url}`);
  const tarballPath = path.join(cacheDir, `${version}.tar.gz`);
  const response = await fetchTarball(url);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tarballPath));

  const extractDir = path.join(cacheDir, `${version}.extracting`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await run('tar', ['-xzf', tarballPath, '-C', extractDir]);
  if (!fs.existsSync(path.join(extractDir, 'bin'))) {
    throw new Error(`Unexpected gitlab-lsp tarball layout: no "bin" directory in ${extractDir}.`);
  }
  const versionDir = path.join(cacheDir, version);
  fs.rmSync(versionDir, { recursive: true, force: true });
  fs.renameSync(extractDir, versionDir);
  fs.rmSync(tarballPath);
  return binDir;
}

let downloadPromise;

export function downloadLspBinaries() {
  downloadPromise ??= download(resolveLspVersion());
  return downloadPromise;
}
