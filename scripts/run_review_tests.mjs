import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runTests } from 'vscode-test';
import { root } from './utils/run_utils.mjs';

const manifestPath = path.join(root, 'dist-desktop/package.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (
  !manifest.contributes.views['gitlab-review'].some(
    view => view.id === 'gitlabReview.testPreparation',
  )
)
  manifest.contributes.views['gitlab-review'].push({
    id: 'gitlabReview.testPreparation',
    name: 'Review Preparation Test',
  });
await fs.writeFile(manifestPath, JSON.stringify(manifest));

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-review-tests-'));
const workspaceFile = path.join(userDataDir, 'review-tests.code-workspace');
await fs.writeFile(
  workspaceFile,
  JSON.stringify({ folders: [{ path: path.join(root, 'test_workspace') }] }),
);
await fs.mkdir(path.join(userDataDir, 'User'));
await fs.writeFile(
  path.join(userDataDir, 'User/settings.json'),
  JSON.stringify({
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'go.toolsManagement.autoUpdate': false,
    'go.toolsManagement.checkForUpdates': 'off',
    'go.survey.prompt': false,
    ...(process.env.REVIEW_TEST_GOPLS_PATH
      ? {
          'go.alternateTools': {
            gopls: process.env.REVIEW_TEST_GOPLS_PATH,
            ...(process.env.REVIEW_TEST_GO_PATH ? { go: process.env.REVIEW_TEST_GO_PATH } : {}),
          },
        }
      : {}),
  }),
);
await runTests({
  ...(process.env.VSCODE_EXECUTABLE_PATH
    ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
    : { version: '1.106.0' }),
  extensionDevelopmentPath: path.join(root, 'dist-desktop'),
  extensionTestsPath: path.join(root, 'dist-desktop/test/review'),
  launchArgs: [
    ...(process.env.REVIEW_TEST_EXTENSIONS_DIR
      ? ['--extensions-dir', process.env.REVIEW_TEST_EXTENSIONS_DIR]
      : ['--disable-extensions']),
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--user-data-dir',
    userDataDir,
    workspaceFile,
  ],
});
