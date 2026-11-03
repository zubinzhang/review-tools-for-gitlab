import fs from 'fs';
import path from 'path';
import { browser, expect } from '@wdio/globals';
import {
  completeAuth,
  openAgentPlatformChat,
  resizeVSCodeWindow,
  sendAgentChatPrompt,
  waitForEditorTab,
} from '../helpers/index.js';
import { logger } from '../helpers/logger_helpers.js';
import { DUO_AGENT_ENABLED, DUO_AGENT_WORKSPACE } from '../wdio.conf.js';

/**
 * GitLab Duo Agent Platform (agentic chat) drives a real Duo session that edits
 * files in the workspace. It is gated behind a feature flag, only available to
 * internal GitLab team members, and flaky.
 *
 * It is therefore opt-in: run it with
 *
 *   E2E_DUO_AGENT=1 TEST_GITLAB_TOKEN=<PAT> npm run test:e2e -- --spec specs/duo_workflow.e2e.js
 *
 * The E2E_DUO_AGENT flag makes wdio.conf.js launch VS Code already pointed at a
 * git-initialized workspace with the right Duo settings (opening a folder at
 * runtime would reload the dev-host and disable the extension). When the flag
 * is unset this describe is skipped and the suite is unaffected.
 */
const describeDuoAgent = DUO_AGENT_ENABLED ? describe : describe.skip;

describeDuoAgent('GitLab Extension Duo Agent Platform', () => {
  const targetFile = 'duo-hello.js';
  const testPrompt = `Create a file named ${targetFile} in the workspace root that prints "hello world" using console.log. Create the file now without asking for confirmation.`;

  before(async () => {
    logger.info(`Workspace: ${DUO_AGENT_WORKSPACE}`);
    await completeAuth();
  });

  it('runs an agentic chat session that creates a file in the workspace', async function () {
    // The agent run takes minutes; override the 60s default mocha test timeout.
    this.timeout(300000);

    // Record at a fixed 1080p window (crisp native frames; see helper + wdio.conf.js).
    await resizeVSCodeWindow(1920, 1080);

    await openAgentPlatformChat();
    await sendAgentChatPrompt(testPrompt);
    logger.info('Submitted agentic chat prompt; waiting for the agent to create the file...');

    // The agent edits files through the extension host, so the most reliable
    // signal is the file appearing on disk (the spec runs in the Node process).
    const expectedPath = path.join(DUO_AGENT_WORKSPACE, targetFile);
    await browser.waitUntil(
      () => fs.existsSync(expectedPath) && fs.readFileSync(expectedPath, 'utf8').length > 0,
      {
        timeout: 240000,
        interval: 3000,
        timeoutMsg: `Agent did not create ${targetFile} within 240s. Likely the Duo Agent Platform feature flag/access is unavailable for this token, the agent needs a confirmation step, or it lacks project context.`,
      },
    );

    const contents = fs.readFileSync(expectedPath, 'utf8');
    logger.info(`Agent wrote ${targetFile}:\n${contents}`);
    expect(contents.toLowerCase()).toContain('hello world');

    // Switch the browsing context back out of the chat iframe so we can drive
    // the main VS Code workbench, then open the file the agent created and
    // verify its content from the editor (a visible action for the recording).
    await browser.switchToFrame(null);
    const workbench = await browser.getWorkbench();
    await browser.executeWorkbench((vscode, filePath) => {
      return vscode.window.showTextDocument(vscode.Uri.file(filePath));
    }, expectedPath);

    const editorView = await workbench.getEditorView();
    await waitForEditorTab(editorView, targetFile);
    const editor = await editorView.openEditor(targetFile);
    const editorText = await editor.getText();
    logger.info(`Editor shows ${targetFile}:\n${editorText}`);
    expect(editorText.toLowerCase()).toContain('hello world');
  });
});
