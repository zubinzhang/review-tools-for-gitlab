import { adaptTheme } from './theme_adapter';

describe('adaptTheme', () => {
  test('maps single vocabulary entries to theme values correctly', () => {
    const testTheme = {
      '--vscode-font-family': 'Arial',
      '--vscode-editor-font-family': 'Monaco',
    };

    const result = adaptTheme(testTheme);

    expect(result['--editor-font-family']).toBe('Arial');
    expect(result['--editor-code-font-family']).toBe('Monaco');
  });

  test('uses first available theme variable when multiple options exist', () => {
    const testTheme = {
      '--vscode-editorWidget-border': '#123456',
      '--vscode-widget-border': '#abcdef',
    };

    const result = adaptTheme(testTheme);

    // Should use the first available option from vocabulary
    expect(result['--editor-border-color']).toBe('#abcdef');
  });

  test('skips vocabulary entries when no matching theme variables exist', () => {
    const testTheme = {
      '--vscode-font-family': 'Arial',
    };

    const result = adaptTheme(testTheme);

    expect(result['--editor-button-foreground']).toBeUndefined();
    expect(result).not.toHaveProperty('--editor-button-foreground');
  });

  test('returns empty object when theme is empty', () => {
    const result = adaptTheme({});

    expect(result).toEqual({});
  });

  test('correctly handles complex CSS values', () => {
    const testTheme = {
      '--vscode-font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
      '--vscode-foreground': 'rgba(204, 204, 204, 0.5)',
      '--vscode-editor-background': 'linear-gradient(to right, #000, #fff)',
      '--vscode-sideBar-background': 'Red',
    };

    const result = adaptTheme(testTheme);

    expect(result['--editor-font-family']).toBe('-apple-system, BlinkMacSystemFont, sans-serif');
    expect(result['--editor-foreground']).toBe('rgba(204, 204, 204, 0.5)');
    expect(result['--editor-background']).toBe('linear-gradient(to right, #000, #fff)');
    expect(result['--editor-background-alternative']).toBe('Red');
  });

  test('preserves exact value types from theme', () => {
    const testTheme = {
      '--vscode-font-family': 'Arial',
      '--vscode-foreground': '#FF0000',
      '--vscode-opacity': '0.5',
    };

    const result = adaptTheme(testTheme);

    expect(typeof result['--editor-font-family']).toBe('string');
    expect(result['--editor-font-family']).toStrictEqual('Arial');
  });
  describe('contrast-critical pairings', () => {
    test('pairs inline-code foreground with the inline-code background', () => {
      // Light High Contrast: white preformat text belongs on #09345f, not on the
      // #F2F2F2 code-block background, which renders it at roughly 1:1.
      const result = adaptTheme({
        '--vscode-textPreformat-foreground': '#FFFFFF',
        '--vscode-textPreformat-background': '#09345f',
        '--vscode-textCodeBlock-background': '#F2F2F2',
      });

      expect(result['--editor-textPreformat-foreground']).toBe('#FFFFFF');
      expect(result['--editor-textPreformat-background']).toBe('#09345f');
      expect(result['--editor-textCodeBlock-background']).toBe('#F2F2F2');
    });

    test('falls back to the code-block background where the theme sets no inline-code background', () => {
      // Dark High Contrast leaves textPreformat.background null.
      const result = adaptTheme({
        '--vscode-textCodeBlock-background': '#000000',
      });

      expect(result['--editor-textPreformat-background']).toBe('#000000');
    });

    test('prefers descriptionForeground over disabledForeground for muted text', () => {
      const result = adaptTheme({
        '--vscode-descriptionForeground': '#717171',
        '--vscode-disabledForeground': '#61616180',
      });

      expect(result['--editor-foreground-muted']).toBe('#717171');
      // Genuinely disabled controls still get the disabled colour.
      expect(result['--editor-foreground-disabled']).toBe('#61616180');
    });

    test('publishes the status and hover colours the webview reads', () => {
      const result = adaptTheme({
        '--vscode-list-hoverBackground': '#2A2D2E',
        '--vscode-editorWarning-foreground': '#FFD370',
        '--vscode-editorInfo-foreground': '#59a4f9',
        '--vscode-charts-green': '#89D185',
      });

      expect(result['--editor-list-hoverBackground']).toBe('#2A2D2E');
      expect(result['--editor-warning-foreground']).toBe('#FFD370');
      expect(result['--editor-info-foreground']).toBe('#59a4f9');
      expect(result['--editor-success-foreground']).toBe('#89D185');
    });

    test('publishes the active contrast border only where the theme defines one', () => {
      // High-contrast themes mark a hovered row with this border instead of a fill;
      // the other themes leave it unset, and the webview must see it as absent.
      expect(
        adaptTheme({ '--vscode-contrastActiveBorder': '#F38518' })['--editor-activeContrastBorder'],
      ).toBe('#F38518');
      expect(adaptTheme({})['--editor-activeContrastBorder']).toBeUndefined();
    });
  });
});
