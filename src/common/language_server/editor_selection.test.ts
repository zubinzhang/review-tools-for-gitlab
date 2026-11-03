import vscode from 'vscode';
import { createFakePartial } from '../test_utils/create_fake_partial';
import {
  getEditorSelectionContext,
  getEditorSelectionPreview,
  getOutputChannelName,
} from './editor_selection';

describe('getEditorSelectionContext', () => {
  const document = createFakePartial<vscode.TextDocument>({
    uri: vscode.Uri.file('/workspace/src/Foo.ts'),
    getText: jest.fn().mockReturnValue('selected text'),
  });

  const setEditor = (selection: vscode.Selection, selections: vscode.Selection[] = [selection]) => {
    vscode.window.activeTextEditor = createFakePartial<vscode.TextEditor>({
      document,
      selection,
      selections,
    });
  };

  beforeEach(() => {
    jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('src/Foo.ts');
  });

  it('returns null when there is no active editor', () => {
    vscode.window.activeTextEditor = undefined;

    expect(getEditorSelectionContext()).toBeNull();
  });

  it('returns null for an empty selection', () => {
    setEditor(new vscode.Selection(3, 2, 3, 2));

    expect(getEditorSelectionContext()).toBeNull();
  });

  it('returns null when the relative path is empty', () => {
    jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('');
    setEditor(new vscode.Selection(1, 0, 2, 0));

    expect(getEditorSelectionContext()).toBeNull();
  });

  it('returns the file name, selected text and a plain LSP range', () => {
    const selection = new vscode.Selection(11, 4, 29, 7);
    setEditor(selection);

    const result = getEditorSelectionContext();

    expect(result).toEqual({
      fileName: 'src/Foo.ts',
      selectedText: 'selected text',
      range: { start: { line: 11, character: 4 }, end: { line: 29, character: 7 } },
    });
    expect(document.getText).toHaveBeenCalledWith(selection);
    expect(vscode.workspace.asRelativePath).toHaveBeenCalledWith(document.uri);
  });

  it('does not include source for a file selection', () => {
    setEditor(new vscode.Selection(11, 4, 29, 7));

    expect(getEditorSelectionContext()).not.toHaveProperty('source');
    expect(getEditorSelectionPreview()).not.toHaveProperty('source');
  });

  describe('Output panel selection', () => {
    const outputUri = (path: string) => vscode.Uri.file('/').with({ scheme: 'output', path });

    it('sends the channel name with source: output, for the reply and the notification', () => {
      vscode.window.activeTextEditor = createFakePartial<vscode.TextEditor>({
        document: createFakePartial<vscode.TextDocument>({
          uri: outputUri('extension-output-GitLab.gitlab-workflow-#1-GitLab Workflow'),
          getText: jest.fn().mockReturnValue('log line'),
        }),
        selection: new vscode.Selection(2, 0, 21, 0),
      });
      const range = { start: { line: 2, character: 0 }, end: { line: 21, character: 0 } };

      expect(getEditorSelectionContext()).toEqual({
        fileName: 'GitLab Workflow',
        selectedText: 'log line',
        range,
        source: 'output',
      });
      expect(getEditorSelectionPreview()).toEqual({
        fileName: 'GitLab Workflow',
        range,
        source: 'output',
      });
      expect(vscode.workspace.asRelativePath).not.toHaveBeenCalled();
    });

    it.each([
      ['an extension channel', 'extension-output-GitLab.gitlab-workflow-#1-GitLab', 'GitLab'],
      [
        'an extension channel with dashes and # in its name',
        'extension-output-pub.ext-name-#12-My - Channel #2',
        'My - Channel #2',
      ],
      [
        'an extension channel with / and # in its name (as seen in VS Code 1.92)',
        'extension-output-nullExtensionDescription-#1-Duo Plain / Test #1',
        'Duo Plain / Test #1',
      ],
      [
        'an extension log channel without .log (VS Code 1.92 through 1.106, the minimum supported)',
        'GitLab.gitlab-workflow.GitLab Language Server',
        'GitLab Language Server',
      ],
      [
        'an extension log channel (VS Code 1.136)',
        'GitLab.gitlab-workflow.GitLab Language Server.log',
        'GitLab Language Server',
      ],
      ['a built-in extension log channel', 'vscode.git.Git', 'Git'],
      ['a built-in channel', 'rendererLog', 'Output'],
      ['an empty channel name', 'extension-output-pub.ext-#1- ', 'Output'],
      ['an empty path', '', 'Output'],
    ])('getOutputChannelName reads %s', (_, path, expected) => {
      expect(getOutputChannelName(outputUri(path))).toBe(expected);
    });
  });

  it('keeps the range an object with start/end after JSON serialization', () => {
    setEditor(new vscode.Selection(11, 0, 29, 0));

    const serialized = JSON.parse(JSON.stringify(getEditorSelectionContext()));

    expect(serialized.range.start.line).toBe(11);
    expect(serialized.range.end.line).toBe(29);
  });

  it('uses Selection.start/end (not anchor/active), so a backwards selection starts before it ends', () => {
    setEditor(new vscode.Selection(29, 7, 11, 4));

    expect(getEditorSelectionContext()?.range).toEqual({
      start: { line: 11, character: 4 },
      end: { line: 29, character: 7 },
    });
  });

  describe('getEditorSelectionPreview', () => {
    it('returns the same file and range as the context, without text and without reading it', () => {
      setEditor(new vscode.Selection(11, 4, 29, 7));
      jest.mocked(document.getText).mockClear();

      const preview = getEditorSelectionPreview();

      expect(preview).toEqual({
        fileName: 'src/Foo.ts',
        range: { start: { line: 11, character: 4 }, end: { line: 29, character: 7 } },
      });
      expect(preview).not.toHaveProperty('selectedText');
      expect(document.getText).not.toHaveBeenCalled();

      const { selectedText, ...contextWithoutText } = getEditorSelectionContext()!;
      expect(selectedText).toBe('selected text');
      expect(contextWithoutText).toEqual(preview);
    });

    it.each([
      [
        'there is no active editor',
        () => {
          vscode.window.activeTextEditor = undefined;
        },
      ],
      ['the selection is empty', () => setEditor(new vscode.Selection(3, 2, 3, 2))],
      [
        'the relative path is empty',
        () => {
          jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('');
          setEditor(new vscode.Selection(1, 0, 2, 0));
        },
      ],
    ])('returns null when %s', (_, arrange) => {
      arrange();

      expect(getEditorSelectionPreview()).toBeNull();
    });
  });

  it('uses the main selection when there are several', () => {
    const main = new vscode.Selection(1, 0, 2, 0);
    setEditor(main, [main, new vscode.Selection(10, 0, 20, 0)]);

    expect(getEditorSelectionContext()?.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 },
    });
  });
});
