import { browser } from '@wdio/globals';
import { logger } from './logger_helpers.js';

const WEBVIEW_TITLE = 'GitLab Duo Agent Platform';

/**
 * Opens the GitLab Duo Agent Platform panel (the LSP-served agentic chat) and
 * switches the active browsing context into its inner chat iframe.
 *
 * The chat lives in nested iframes (VS Code webview iframe -> chat iframe), so
 * we switch top iframe[0] -> inner iframe[0] before querying chat elements.
 *
 * @async
 * @returns {Promise<void>}
 */
const openAgentPlatformChat = async () => {
  logger.info(`Opening "${WEBVIEW_TITLE}" panel...`);
  const workbench = await browser.getWorkbench();

  await browser.waitUntil(
    async () => {
      await workbench.executeCommand('Gitlab: Show Duo Agent Platform');
      await browser.pause(2000);
      return (await workbench.getWebviewByTitle(WEBVIEW_TITLE)) !== null;
    },
    {
      timeout: 30000,
      interval: 1000,
      timeoutMsg: `"${WEBVIEW_TITLE}" webview never opened.`,
    },
  );

  const webview = await workbench.getWebviewByTitle(WEBVIEW_TITLE);
  await webview.open();

  // Switch into the nested chat iframe.
  await browser.pause(4000);
  const top = await browser.$$('iframe');
  await browser.switchToFrame(top[0]);
  const inner = await browser.$$('iframe');
  await browser.switchToFrame(inner[0]);
};

/**
 * Types a prompt into the agentic chat input and submits it.
 * Call after openAgentPlatformChat() (must be inside the chat iframe).
 *
 * @async
 * @param {String} text prompt to send
 * @returns {Promise<void>}
 */
const sendAgentChatPrompt = async text => {
  logger.info('Sending agentic chat prompt...');
  const input = await $('[data-testid="chat-prompt-input"]');
  await input.waitForExist({ timeout: 20000 });
  await input.click();
  await input.setValue(text);
  await $('[data-testid="chat-prompt-submit-button"]').click();
};

/**
 * Resizes the launched VS Code window to a fixed size for recording.
 *
 * wdio's setWindowSize/setWindowRect fail against the Electron-based VS Code
 * session (the embedded chromedriver lacks the CDP Browser domain) and the
 * `--window-size` launch flag is ignored by VS Code on macOS, so we resize the
 * window at runtime from inside its own renderer with `window.resizeTo` (the
 * documented VS Code recording trick). The window content is what the video
 * reporter screenshots, so combined with forceDeviceScaleFactor=1 in
 * wdio.conf.js this yields crisp ~1080p frames.
 *
 * Must be called while the active context is the main workbench window (i.e.
 * before switching into a webview iframe).
 *
 * @async
 * @param {number} [width=1920]
 * @param {number} [height=1080]
 * @returns {Promise<void>}
 */
const resizeVSCodeWindow = async (width = 1920, height = 1080) => {
  const size = await browser.execute(
    (w, h) => {
      window.resizeTo(w, h);
      return { width: window.outerWidth, height: window.outerHeight };
    },
    width,
    height,
  );
  logger.info(`Requested VS Code window ${width}x${height}; now ${size.width}x${size.height}.`);
};

export { openAgentPlatformChat, sendAgentChatPrompt, resizeVSCodeWindow };
