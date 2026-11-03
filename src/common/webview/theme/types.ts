export const THEME_KINDS = ['dark', 'light', 'high-contrast-dark', 'high-contrast-light'] as const;

/**
 * Which class of theme the editor is running. The webview cannot derive this from
 * the colours alone: high-contrast themes paint every surface the same colour and
 * carry structure on borders instead, and luminance is ambiguous
 */
export type ThemeKind = (typeof THEME_KINDS)[number];

export type Theme = {
  styles: Record<string, string>;
  kind?: ThemeKind;
};

export interface WebviewThemePublisher {
  publishWebviewTheme(theme: Theme): Promise<void>;
  setDuoWorkflowInitialState(initialState: Record<string, unknown>): Promise<void>;
}
