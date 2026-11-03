import * as vscode from 'vscode';
import {
  getDuoCodeSuggestionsConfiguration,
  setDuoCodeSuggestionsConfiguration,
} from '../../utils/extension_configuration';
import { isLanguageDisabled, normalizeLanguageId } from '../disabled_languages';

export const COMMAND_TOGGLE_CODE_SUGGESTIONS_FOR_LANGUAGE = 'gl.toggleCodeSuggestionsForLanguage';

export const toggleCodeSuggestionsForLanguage = async () => {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    await vscode.window.showWarningMessage(
      'GitLab: could not toggle language, as no text editor is active.',
    );
    return;
  }

  const { languageId } = editor.document;
  const { disabledLanguages } = getDuoCodeSuggestionsConfiguration();

  const newDisabledLanguages = isLanguageDisabled(languageId, disabledLanguages)
    ? disabledLanguages.filter(
        language => normalizeLanguageId(language) !== normalizeLanguageId(languageId),
      )
    : [...disabledLanguages, languageId];

  await setDuoCodeSuggestionsConfiguration({ disabledLanguages: newDisabledLanguages });
};
