import * as vscode from 'vscode';
import { log } from '../log';
import { getErrorScreenHtml } from '../chat/error_screen';
import { getWebviewContent } from './get_ls_webview_content';
import { applyMiddleware, WebviewContainerMiddleware } from './middleware';

export type WebviewControllerProps = {
  viewId: string;
  url: URL;
  title: string;
  description?: string;
  middlewares?: WebviewContainerMiddleware[];
};

const getWebviewUnreachableCause = (port: string): string =>
  `GitLab couldn't reach a service running on localhost:${port} that this view depends on.`;

const getWebviewUnreachableDesktopMessage = (port: string): string =>
  `${getWebviewUnreachableCause(port)}\n\n` +
  `In the Ports panel (View > Open View... > Ports), find and open port ${port}.`;

const getWebviewUnreachableWebMessage = (port: string): string =>
  `${getWebviewUnreachableCause(port)}\n\n` +
  "Some browser-based VS Code environments can't forward this type of localhost port. " +
  `If a Ports panel is available (View > Open View... > Ports), find and open port ${port}.`;

export const getWebviewUnreachableMessage = (port: string): string =>
  vscode.env.uiKind === vscode.UIKind.Web
    ? getWebviewUnreachableWebMessage(port)
    : getWebviewUnreachableDesktopMessage(port);

export const WEBVIEW_UNREACHABLE_DOC_LINK = {
  text: "If this doesn't resolve the issue, see the VS Code troubleshooting documentation.",
  url: 'https://docs.gitlab.com/editor_extensions/visual_studio_code/troubleshooting/#unreachable-localhost-port',
};

const isLoopbackHost = (host: string): boolean => {
  // URL.hostname keeps IPv6 addresses wrapped in brackets, e.g. "[::1]".
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    /^127\./.test(normalized)
  );
};

const LOADING_SCREEN_HTML = `
  <!DOCTYPE html>
  <html lang="en">
  <body style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:var(--vscode-font-family);color:var(--vscode-descriptionForeground);">
    Loading…
  </body>
  </html>
`;

export class LsWebviewController implements vscode.WebviewViewProvider {
  protected viewId: string;

  #url: URL;

  #title: string;

  protected view: vscode.WebviewView | undefined;

  #middlewares: WebviewContainerMiddleware[];

  protected isUrlReachable = true;

  constructor({ viewId, url, title, middlewares }: WebviewControllerProps) {
    this.viewId = viewId;
    this.#url = url;
    this.#title = title;
    this.#middlewares = middlewares ?? [];
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    this.view.webview.options = {
      enableScripts: true,
    };

    this.view.title = this.#title;
    // The reachability check below can take up to its timeout to resolve; show a
    // placeholder immediately so the view isn't blank while it's pending.
    this.view.webview.html = LOADING_SCREEN_HTML;

    this.isUrlReachable = await this.#isUrlAvailble(this.#url);

    // The check above runs in the extension host, which shares a host with the
    // Language Server, so it can reach localhost even when the browser can't. In
    // browser-based VS Code the webview iframe runs in the user's browser, so it
    // can only load the URL if asExternalUri rewrote localhost to a
    // browser-reachable host. Some browser-based environments (e.g. code-server /
    // Coder) don't forward this kind of port, leaving the URL as loopback — which
    // the iframe can't reach, producing a raw "127.0.0.1 failed to connect" error
    // instead of our error screen. Treat that as unreachable.
    if (this.isUrlReachable && vscode.env.uiKind === vscode.UIKind.Web) {
      const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(this.#url.toString()));
      if (isLoopbackHost(new URL(externalUri.toString(true)).hostname)) {
        this.isUrlReachable = false;
      }
    }

    log.debug(`${this.viewId} url is ${this.isUrlReachable ? '' : 'not '}available`);

    if (!this.isUrlReachable) {
      this.view.webview.html = getErrorScreenHtml(
        getWebviewUnreachableMessage(this.#url.port),
        `Error loading ${this.#title}`,
        WEBVIEW_UNREACHABLE_DOC_LINK,
      );
      return;
    }

    this.view.webview.html = await getWebviewContent(this.#url, this.view.title);

    if (this.#middlewares.length > 0) {
      applyMiddleware(this.view, this.#middlewares);
    }
  }

  async show() {
    if (this.view) {
      if (!this.view.visible) {
        this.view.show();
      }
    } else {
      await vscode.commands.executeCommand(`${this.viewId}.focus`);
    }
  }

  async #isUrlAvailble(url: URL, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });

      return true;
    } catch {
      log.error(`Error checking ${this.viewId} url: ${url}`);
      return false;
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
    }
  }
}
