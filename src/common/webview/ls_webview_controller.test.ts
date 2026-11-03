import * as vscode from 'vscode';
import { createFakePartial } from '../test_utils/create_fake_partial';
import { escapeHtml } from './escape_html';
import {
  LsWebviewController,
  getWebviewUnreachableMessage,
  WEBVIEW_UNREACHABLE_DOC_LINK,
} from './ls_webview_controller';
import { getWebviewContent } from './get_ls_webview_content';
import { applyMiddleware } from './middleware';

jest.mock('./get_ls_webview_content');
jest.mock('./middleware');

describe('LsWebviewController', () => {
  const mockUrl = new URL('http://localhost:12345');
  const mockTitle = 'test-title';
  const mockViewId = 'test-view-id';

  let controller: LsWebviewController;
  let mockWebviewView: vscode.WebviewView;

  beforeEach(() => {
    // mocking for isUrlAvailable
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve({ ok: true }));
    jest.mocked(vscode.env.asExternalUri).mockResolvedValue(vscode.Uri.parse(mockUrl.toString()));

    controller = new LsWebviewController({
      viewId: mockViewId,
      url: mockUrl,
      title: mockTitle,
    });

    mockWebviewView = createFakePartial<vscode.WebviewView>({
      webview: {
        options: {},
      },
      show: jest.fn(),
      visible: false,
    });

    (getWebviewContent as jest.Mock).mockReturnValue('<mock-html-content>');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveWebviewView', () => {
    it('sets up the webview correctly', async () => {
      await controller.resolveWebviewView(mockWebviewView);

      expect(mockWebviewView.webview.options).toEqual({ enableScripts: true });
      expect(mockWebviewView.title).toBe(mockTitle);
      expect(mockWebviewView.webview.html).toBe('<mock-html-content>');
      expect(getWebviewContent).toHaveBeenCalledWith(mockUrl, mockTitle);
    });

    describe('when middleware is provided', () => {
      it('applies the middleware', async () => {
        const mockMiddleware = jest.fn();
        controller = new LsWebviewController({
          viewId: mockViewId,
          url: mockUrl,
          title: mockTitle,
          middlewares: [mockMiddleware],
        });

        await controller.resolveWebviewView(mockWebviewView);

        expect(applyMiddleware).toHaveBeenCalledWith(mockWebviewView, [mockMiddleware]);
      });
    });

    describe('when middleware is not provided', () => {
      it('does not apply middleware', async () => {
        await controller.resolveWebviewView(mockWebviewView);

        expect(applyMiddleware).not.toHaveBeenCalled();
      });
    });

    describe('when the LS url is not reachable', () => {
      beforeEach(() => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
      });

      it('renders an error screen instead of loading the LS webview content', async () => {
        await controller.resolveWebviewView(mockWebviewView);

        expect(getWebviewContent).not.toHaveBeenCalled();
        expect(mockWebviewView.webview.html).toContain(
          escapeHtml(getWebviewUnreachableMessage(mockUrl.port)),
        );
        expect(mockWebviewView.webview.html).toContain(escapeHtml(`Error loading ${mockTitle}`));
        expect(mockWebviewView.webview.html).toContain(
          `href="${escapeHtml(WEBVIEW_UNREACHABLE_DOC_LINK.url)}"`,
        );
        expect(mockWebviewView.webview.html).toContain(
          escapeHtml(WEBVIEW_UNREACHABLE_DOC_LINK.text),
        );
      });

      it('does not apply middleware', async () => {
        controller = new LsWebviewController({
          viewId: mockViewId,
          url: mockUrl,
          title: mockTitle,
          middlewares: [jest.fn()],
        });

        await controller.resolveWebviewView(mockWebviewView);

        expect(applyMiddleware).not.toHaveBeenCalled();
      });

      describe('when running in a browser-based VS Code (uiKind: Web)', () => {
        beforeEach(() => {
          (vscode.env as { uiKind?: number }).uiKind = vscode.UIKind.Web;
        });

        afterEach(() => {
          (vscode.env as { uiKind?: number }).uiKind = vscode.UIKind.Desktop;
        });

        it('shows browser-specific guidance instead of the desktop Ports panel instructions', async () => {
          await controller.resolveWebviewView(mockWebviewView);

          expect(mockWebviewView.webview.html).toContain(
            escapeHtml(
              "Some browser-based VS Code environments can't forward this type of localhost port",
            ),
          );
          expect(mockWebviewView.webview.html).not.toContain(escapeHtml('In the Ports panel'));
        });
      });
    });

    describe('when the LS url responds with a non-2xx status', () => {
      beforeEach(() => {
        global.fetch = jest.fn().mockImplementation(() => Promise.resolve({ ok: false }));
      });

      it('renders the LS webview content, since the port is still reachable', async () => {
        await controller.resolveWebviewView(mockWebviewView);

        expect(mockWebviewView.webview.html).toBe('<mock-html-content>');
        expect(getWebviewContent).toHaveBeenCalledWith(mockUrl, mockTitle);
      });
    });

    describe('when the LS url is reachable from the extension host but not the browser', () => {
      // The extension host shares a host with the LS, so the server-side check
      // passes, but in browser-based VS Code the iframe can only load the URL if
      // asExternalUri rewrote localhost to a browser-reachable host.
      beforeEach(() => {
        global.fetch = jest.fn().mockImplementation(() => Promise.resolve({ ok: true }));
        (vscode.env as { uiKind?: number }).uiKind = vscode.UIKind.Web;
      });

      afterEach(() => {
        (vscode.env as { uiKind?: number }).uiKind = vscode.UIKind.Desktop;
      });

      describe('when asExternalUri did not forward the localhost port', () => {
        beforeEach(() => {
          jest
            .mocked(vscode.env.asExternalUri)
            .mockResolvedValue(vscode.Uri.parse(mockUrl.toString()));
        });

        it('renders the error screen instead of the LS webview content', async () => {
          await controller.resolveWebviewView(mockWebviewView);

          expect(getWebviewContent).not.toHaveBeenCalled();
          expect(mockWebviewView.webview.html).toContain(
            escapeHtml(getWebviewUnreachableMessage(mockUrl.port)),
          );
        });
      });

      describe('when asExternalUri forwarded the port to a browser-reachable host', () => {
        beforeEach(() => {
          jest
            .mocked(vscode.env.asExternalUri)
            .mockResolvedValue(vscode.Uri.parse('https://forwarded.example.com/'));
        });

        it('renders the LS webview content', async () => {
          await controller.resolveWebviewView(mockWebviewView);

          expect(mockWebviewView.webview.html).toBe('<mock-html-content>');
          expect(getWebviewContent).toHaveBeenCalledWith(mockUrl, mockTitle);
        });
      });
    });
  });

  describe('show', () => {
    describe('when view exists', () => {
      describe('when view is visible', () => {
        it('does not call show', async () => {
          mockWebviewView = createFakePartial<vscode.WebviewView>({
            ...mockWebviewView,
            visible: true,
          });
          await controller.resolveWebviewView(mockWebviewView);

          await controller.show();

          expect(mockWebviewView.show).not.toHaveBeenCalled();
        });
      });
      describe('when view is not visible', () => {
        it('shows the view', async () => {
          await controller.resolveWebviewView(mockWebviewView);

          await controller.show();

          expect(mockWebviewView.show).toHaveBeenCalled();
        });
      });
    });

    describe('when view does not exist', () => {
      it('executes focus command', async () => {
        const mockExecuteCommand = jest
          .spyOn(vscode.commands, 'executeCommand')
          .mockResolvedValue(undefined);

        await controller.show();

        expect(mockExecuteCommand).toHaveBeenCalledWith('test-view-id.focus');
      });
    });
  });
});
