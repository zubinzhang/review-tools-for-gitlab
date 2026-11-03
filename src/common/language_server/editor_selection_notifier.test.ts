import vscode from 'vscode';
import { createFakePartial } from '../test_utils/create_fake_partial';
import { EDITOR_SELECTION_DEBOUNCE_MS, EditorSelectionNotifier } from './editor_selection_notifier';

jest.mock('../log');

describe('EditorSelectionNotifier', () => {
  let send: jest.Mock;
  let notifier: EditorSelectionNotifier;
  let fireSelectionChange: (editor: vscode.TextEditor) => void;
  let fireActiveEditorChange: () => void;
  const selectionListenerDisposable = { dispose: jest.fn() };
  const activeEditorListenerDisposable = { dispose: jest.fn() };

  const createEditor = (selection: vscode.Selection, text = 'selected') =>
    createFakePartial<vscode.TextEditor>({
      document: createFakePartial<vscode.TextDocument>({
        uri: vscode.Uri.file('/workspace/Foo.ts'),
        getText: jest.fn().mockReturnValue(text),
      }),
      selection,
    });

  const select = (selection: vscode.Selection) => {
    const editor = createEditor(selection);
    vscode.window.activeTextEditor = editor;
    fireSelectionChange(editor);
  };

  const expectedPayload = (startLine: number, endLine: number) => ({
    fileName: 'Foo.ts',
    range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('Foo.ts');
    jest.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(listener => {
      fireSelectionChange = editor =>
        listener(createFakePartial<vscode.TextEditorSelectionChangeEvent>({ textEditor: editor }));
      return selectionListenerDisposable;
    });
    jest.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(listener => {
      fireActiveEditorChange = () => listener(vscode.window.activeTextEditor);
      return activeEditorListenerDisposable;
    });
    vscode.window.activeTextEditor = undefined;
    send = jest.fn();
    notifier = new EditorSelectionNotifier(send);
  });

  afterEach(() => {
    notifier.dispose();
    jest.useRealTimers();
  });

  it('sends once after the debounce for quick selection changes', async () => {
    select(new vscode.Selection(1, 0, 2, 0));
    select(new vscode.Selection(1, 0, 3, 0));
    select(new vscode.Selection(1, 0, 4, 0));

    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS - 1);
    expect(send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expectedPayload(1, 4));
  });

  it('ignores selection events from editors that are not active', async () => {
    vscode.window.activeTextEditor = createEditor(new vscode.Selection(1, 0, 2, 0));
    fireSelectionChange(createEditor(new vscode.Selection(5, 0, 6, 0)));

    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends null when the selection is cleared', async () => {
    select(new vscode.Selection(1, 0, 2, 0));
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    select(new vscode.Selection(2, 0, 2, 0));
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenLastCalledWith(null);
  });

  it('sends null when there is no active editor', async () => {
    select(new vscode.Selection(1, 0, 2, 0));
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    vscode.window.activeTextEditor = undefined;
    fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(null);
  });

  it('sends the new selection when switching to another editor', async () => {
    vscode.window.activeTextEditor = createEditor(new vscode.Selection(7, 0, 8, 0));
    fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledWith(expectedPayload(7, 8));
  });

  it('skips the send when nothing changed', async () => {
    select(new vscode.Selection(1, 0, 2, 0));
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);
    select(new vscode.Selection(1, 0, 2, 0));
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips repeated null sends', async () => {
    await notifier.sendNow();
    fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(null);
  });

  it('sendNow sends immediately', async () => {
    vscode.window.activeTextEditor = createEditor(new vscode.Selection(1, 0, 2, 0));

    await notifier.sendNow();

    expect(send).toHaveBeenCalledWith(expectedPayload(1, 2));
  });

  it('sends no selectedText and does not read the document, even for a large selection', async () => {
    const editor = createEditor(new vscode.Selection(0, 0, 100_000, 0), 'x'.repeat(10_000_000));
    vscode.window.activeTextEditor = editor;
    fireSelectionChange(editor);
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).not.toHaveProperty('selectedText');
    expect(send).toHaveBeenCalledWith(expectedPayload(0, 100_000));
    expect(editor.document.getText).not.toHaveBeenCalled();
  });

  it('skips the send when only the text changed', async () => {
    const range = new vscode.Selection(1, 0, 2, 0);
    vscode.window.activeTextEditor = createEditor(range, 'before typing');
    await notifier.sendNow();

    const edited = createEditor(range, 'after typing');
    vscode.window.activeTextEditor = edited;
    fireSelectionChange(edited);
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries on the next change after a failed send', async () => {
    send.mockRejectedValueOnce(new Error('not running'));
    vscode.window.activeTextEditor = createEditor(new vscode.Selection(1, 0, 2, 0));
    await notifier.sendNow();

    await notifier.sendNow();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('resend sends the selection even when it is unchanged', async () => {
    vscode.window.activeTextEditor = createEditor(new vscode.Selection(1, 0, 2, 0));
    await notifier.sendNow();

    await notifier.resend();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expectedPayload(1, 2));
  });

  describe('when canSend returns false', () => {
    let canSend: jest.Mock;

    beforeEach(() => {
      notifier.dispose();
      canSend = jest.fn().mockReturnValue(false);
      notifier = new EditorSelectionNotifier(send, canSend);
    });

    it('skips sends without recording them', async () => {
      vscode.window.activeTextEditor = createEditor(new vscode.Selection(1, 0, 2, 0));
      await notifier.sendNow();
      expect(send).not.toHaveBeenCalled();

      canSend.mockReturnValue(true);
      await notifier.sendNow();

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expectedPayload(1, 2));
    });
  });

  it('cancels pending sends and stops listening on dispose', async () => {
    select(new vscode.Selection(1, 0, 2, 0));

    notifier.dispose();
    await jest.advanceTimersByTimeAsync(EDITOR_SELECTION_DEBOUNCE_MS);
    await notifier.sendNow();

    expect(send).not.toHaveBeenCalled();
    expect(selectionListenerDisposable.dispose).toHaveBeenCalled();
    expect(activeEditorListenerDisposable.dispose).toHaveBeenCalled();
  });
});
