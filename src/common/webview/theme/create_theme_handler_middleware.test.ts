import * as vscode from 'vscode';
import { WebviewContainer } from '../middleware';
import { log } from '../../log';
import {
  createThemeHandlerMiddleware,
  WEBVIEW_THEME_CHANGED_MESSAGE_TYPE,
} from './create_theme_handler_middleware';
import { WebviewThemePublisher } from './types';
import { adaptTheme } from './theme_adapter';

jest.mock('./theme_adapter');
jest.mock('../../log', () => ({ log: { warn: jest.fn() } }));

jest.mock('vscode', () => ({
  window: {
    onDidChangeActiveColorTheme: jest.fn(),
    activeColorTheme: { kind: 2 },
  },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
}));

describe('createThemeHandlerMiddleware', () => {
  let mockThemePublisher: WebviewThemePublisher;
  let mockContainer: WebviewContainer;
  let mockWebview: vscode.Webview;
  let mockOnDidDispose: jest.Mock;
  let middleware: ReturnType<typeof createThemeHandlerMiddleware>;

  beforeEach(() => {
    mockThemePublisher = {
      publishWebviewTheme: jest.fn().mockResolvedValue(undefined),
      setDuoWorkflowInitialState: jest.fn(),
    };

    mockWebview = {
      onDidReceiveMessage: jest.fn(),
      postMessage: jest.fn(),
      html: '<head></head>',
    } as Partial<vscode.Webview> as vscode.Webview;

    mockOnDidDispose = jest.fn();

    mockContainer = {
      webview: mockWebview,
      onDidDispose: mockOnDidDispose,
    };

    middleware = createThemeHandlerMiddleware(mockThemePublisher);
  });

  it('should add script to webview HTML', () => {
    middleware(mockContainer);
    const expectedRegex = /<head><script>.*<\/script><\/head>/;
    expect(mockContainer.webview.html.replace(/\s+/g, '')).toMatch(expectedRegex);
  });

  it('should set up message listener for theme changes', () => {
    const mockAddEventListener = jest.fn();
    jest.mocked(mockWebview.onDidReceiveMessage).mockImplementation(callback => {
      mockAddEventListener('message', callback);
      return { dispose: jest.fn() };
    });

    middleware(mockContainer);

    expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
    expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should publish the adaptedtheme when receiving a valid theme message', async () => {
    const mockMessage = {
      type: WEBVIEW_THEME_CHANGED_MESSAGE_TYPE,
      cssVariables: { '--test-var': 'test-value' },
    };

    jest.mocked(mockWebview.onDidReceiveMessage).mockImplementation(callback => {
      callback(mockMessage);
      return { dispose: jest.fn() };
    });
    jest.mocked(adaptTheme).mockReturnValue({
      foo: 'bar',
    });

    middleware(mockContainer);

    expect(adaptTheme).toHaveBeenCalledWith(mockMessage.cssVariables);
    expect(mockThemePublisher.publishWebviewTheme).toHaveBeenCalledWith({
      styles: {
        foo: 'bar',
      },
      kind: 'dark',
    });
  });

  it.each([
    [vscode.ColorThemeKind.Light, 'light'],
    [vscode.ColorThemeKind.Dark, 'dark'],
    [vscode.ColorThemeKind.HighContrast, 'high-contrast-dark'],
    [vscode.ColorThemeKind.HighContrastLight, 'high-contrast-light'],
  ])('reports ColorThemeKind %p as kind %p', async (colorThemeKind, expectedKind) => {
    jest.replaceProperty(vscode.window, 'activeColorTheme', {
      kind: colorThemeKind,
    } as vscode.ColorTheme);

    jest.mocked(mockWebview.onDidReceiveMessage).mockImplementation(callback => {
      callback({
        type: WEBVIEW_THEME_CHANGED_MESSAGE_TYPE,
        cssVariables: {},
      });
      return { dispose: jest.fn() };
    });
    jest.mocked(adaptTheme).mockReturnValue({});

    middleware(mockContainer);

    expect(mockThemePublisher.publishWebviewTheme).toHaveBeenCalledWith(
      expect.objectContaining({ kind: expectedKind }),
    );
  });

  it('falls back to dark and warns for an unknown ColorThemeKind', () => {
    jest.replaceProperty(vscode.window, 'activeColorTheme', {
      kind: 99 as vscode.ColorThemeKind,
    } as vscode.ColorTheme);

    jest.mocked(mockWebview.onDidReceiveMessage).mockImplementation(callback => {
      callback({
        type: WEBVIEW_THEME_CHANGED_MESSAGE_TYPE,
        cssVariables: {},
      });
      return { dispose: jest.fn() };
    });
    jest.mocked(adaptTheme).mockReturnValue({});

    middleware(mockContainer);

    expect(mockThemePublisher.publishWebviewTheme).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dark' }),
    );
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('99'));
  });

  it('should not publish theme when receiving a message different from theme message', () => {
    const mockMessage = { type: 'non-theme-type' };

    jest.mocked(mockWebview.onDidReceiveMessage).mockImplementation(callback => {
      callback(mockMessage);
      return { dispose: jest.fn() };
    });

    middleware(mockContainer);

    expect(mockThemePublisher.publishWebviewTheme).not.toHaveBeenCalled();
  });

  it('should set up listener for VS Code theme changes', () => {
    const mockAddThemeChangeListener = jest.fn();
    jest.mocked(vscode.window.onDidChangeActiveColorTheme).mockImplementation(callback => {
      mockAddThemeChangeListener('themeChange', callback);
      return { dispose: jest.fn() };
    });

    middleware(mockContainer);

    expect(vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled();
    expect(mockAddThemeChangeListener).toHaveBeenCalledWith('themeChange', expect.any(Function));
  });

  it('should post message when VS Code theme changes', () => {
    let themeChangeCallback = () => {};

    jest.mocked(vscode.window.onDidChangeActiveColorTheme).mockImplementation(callback => {
      themeChangeCallback = callback as () => void;
      return { dispose: jest.fn() };
    });

    middleware(mockContainer);
    themeChangeCallback();

    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: WEBVIEW_THEME_CHANGED_MESSAGE_TYPE,
    });
  });

  it('should dispose of subscriptions when container is disposed', () => {
    const mockDispose1 = jest.fn();
    const mockDispose2 = jest.fn();

    jest.mocked(mockWebview.onDidReceiveMessage).mockReturnValue({ dispose: mockDispose1 });

    jest
      .mocked(vscode.window.onDidChangeActiveColorTheme)
      .mockReturnValue({ dispose: mockDispose2 });

    middleware(mockContainer);

    const disposeCb = mockOnDidDispose.mock.calls[0][0];
    disposeCb();

    expect(mockDispose1).toHaveBeenCalled();
    expect(mockDispose2).toHaveBeenCalled();
  });
});
