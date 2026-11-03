import vscode from 'vscode';
import { debounce, isEqual } from 'lodash';
import { log } from '../log';
import { doNotAwait } from '../utils/do_not_await';
import { EditorSelectionPreview, getEditorSelectionPreview } from './editor_selection';

export const EDITOR_SELECTION_DEBOUNCE_MS = 200;

type SendSelection = (payload: EditorSelectionPreview | null) => Promise<void> | void;

/**
 * Pushes selection changes for the preview badge. The text is left out; the
 * language server requests it when a message is sent.
 */
export class EditorSelectionNotifier implements vscode.Disposable {
  #send: SendSelection;

  #subscriptions: vscode.Disposable[] = [];

  // `undefined` means nothing has been sent yet; `null` means "no selection" was sent.
  #lastSent: EditorSelectionPreview | null | undefined;

  #disposed = false;

  // flush() handles its own errors, so there's nothing to await here.
  #flushDebounced = debounce(() => doNotAwait(this.flush()), EDITOR_SELECTION_DEBOUNCE_MS);

  #canSend: () => boolean;

  /**
   * @param canSend when it returns false (e.g. the client isn't running), changes are
   * skipped without being recorded. Call `resend()` once sending works again.
   */
  constructor(send: SendSelection, canSend: () => boolean = () => true) {
    this.#send = send;
    this.#canSend = canSend;
    this.#subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor !== vscode.window.activeTextEditor) return;
        this.#flushDebounced();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.#flushDebounced()),
    );
  }

  async flush(): Promise<void> {
    if (this.#disposed || !this.#canSend()) return;

    const payload = getEditorSelectionPreview();
    if (this.#lastSent !== undefined && isEqual(payload, this.#lastSent)) return;

    this.#lastSent = payload;
    try {
      await this.#send(payload);
    } catch (e) {
      // Forget the last send so the next change retries.
      this.#lastSent = undefined;
      log.warn('Failed to send editor selection to the language server', e);
    }
  }

  async sendNow(): Promise<void> {
    this.#flushDebounced.cancel();
    await this.flush();
  }

  /** Sends the current selection even if it's unchanged, e.g. after the language server restarts. */
  async resend(): Promise<void> {
    this.#lastSent = undefined;
    await this.sendNow();
  }

  dispose(): void {
    this.#disposed = true;
    this.#flushDebounced.cancel();
    this.#subscriptions.forEach(s => s.dispose());
    this.#subscriptions = [];
  }
}
