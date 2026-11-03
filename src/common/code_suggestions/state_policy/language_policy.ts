import * as vscode from 'vscode';
import {
  DUO_CODE_SUGGESTIONS_DISABLED_LANGUAGES,
  getDuoCodeSuggestionsConfiguration,
} from '../../utils/extension_configuration';
import { isLanguageDisabled } from '../disabled_languages';
import { StatePolicy, VisibleState } from './state_policy';

export const DISABLED_LANGUAGE_VIA_SETTINGS: VisibleState =
  'code-suggestions-document-disabled-language';

export class LanguagePolicy implements StatePolicy {
  #subscriptions: vscode.Disposable[] = [];

  #eventEmitter = new vscode.EventEmitter<boolean>();

  engaged = false;

  readonly state: VisibleState = DISABLED_LANGUAGE_VIA_SETTINGS;

  constructor() {
    this.#subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(DUO_CODE_SUGGESTIONS_DISABLED_LANGUAGES)) {
          this.#update(vscode.window.activeTextEditor);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(editor => this.#update(editor)),
    );
  }

  async init() {
    this.#update(vscode.window.activeTextEditor);
  }

  onEngagedChange = this.#eventEmitter.event;

  dispose() {
    this.#subscriptions.forEach(s => s.dispose());
  }

  #update(editor?: vscode.TextEditor) {
    const languageId = editor?.document.languageId;
    const { disabledLanguages } = getDuoCodeSuggestionsConfiguration();
    const engaged = languageId !== undefined && isLanguageDisabled(languageId, disabledLanguages);

    if (engaged === this.engaged) return;

    this.engaged = engaged;
    this.#eventEmitter.fire(engaged);
  }
}
