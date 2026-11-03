import vscode from 'vscode';
import type { SelectionContext } from '@gitlab-org/gitlab-lsp';
import { getFileName } from '../chat/utils/editor_text_utils';

type LspRange = NonNullable<SelectionContext['range']>;

const OUTPUT_SCHEME = 'output';
const OUTPUT_FALLBACK_NAME = 'Output';

// Output document paths (no leading slash):
// - createOutputChannel(name):               `extension-output-<extensionId>-#<n>-<name>`
// - createOutputChannel(name, { log: true }): `<extensionId>.<name>` in VS Code 1.92 through
//   at least 1.106 (our minimum), `<extensionId>.<sanitized name>.log` by 1.136. Keep both.
// Built-in channels (e.g. `rendererLog`) have no readable name.
const EXTENSION_CHANNEL_PATH = /^extension-output-[^#]+-#\d+-(.+)$/s;
const EXTENSION_LOG_CHANNEL_PATH = /^[^./]+\.[^./]+\.(.+?)(?:\.log)?$/s;

export const getOutputChannelName = (uri: vscode.Uri): string => {
  const match = EXTENSION_CHANNEL_PATH.exec(uri.path) ?? EXTENSION_LOG_CHANNEL_PATH.exec(uri.path);
  return match?.[1]?.trim() || OUTPUT_FALLBACK_NAME;
};

const getSelectionLocation = (
  document: vscode.TextDocument,
): Pick<SelectionContext, 'fileName' | 'source'> =>
  document.uri.scheme === OUTPUT_SCHEME
    ? { fileName: getOutputChannelName(document.uri), source: 'output' }
    : { fileName: getFileName(document) };

// vscode.Range serializes to `[start, end]`, which the language server doesn't accept.
const toLspRange = ({ start, end }: vscode.Range): LspRange => ({
  start: { line: start.line, character: start.character },
  end: { line: end.line, character: end.character },
});

export type EditorSelectionPreview = Omit<SelectionContext, 'selectedText'>;

const getActiveSelection = () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor?.document || !editor.selection || editor.selection.isEmpty) return null;

  const location = getSelectionLocation(editor.document);
  if (!location.fileName) return null;

  return { editor, preview: { ...location, range: toLspRange(editor.selection) } };
};

/** Doesn't read the document text, so it stays cheap on every selection change. */
export const getEditorSelectionPreview = (): EditorSelectionPreview | null =>
  getActiveSelection()?.preview ?? null;

export const getEditorSelectionContext = (): SelectionContext | null => {
  const active = getActiveSelection();
  if (!active) return null;

  const { editor, preview } = active;
  return { ...preview, selectedText: editor.document.getText(editor.selection) };
};
