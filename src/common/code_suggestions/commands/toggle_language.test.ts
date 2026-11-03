import * as vscode from 'vscode';
import {
  getDuoCodeSuggestionsConfiguration,
  setDuoCodeSuggestionsConfiguration,
  DuoCodeSuggestionsConfiguration,
} from '../../utils/extension_configuration';
import { createFakePartial } from '../../test_utils/create_fake_partial';
import { toggleCodeSuggestionsForLanguage } from './toggle_language';

jest.mock('../../utils/extension_configuration');

function setDisabledLanguages(disabledLanguages: string[]) {
  jest
    .mocked(getDuoCodeSuggestionsConfiguration)
    .mockReturnValue(
      createFakePartial<DuoCodeSuggestionsConfiguration>({ enabled: true, disabledLanguages }),
    );
}

function setActiveTextEditorLanguage(languageId: string | undefined) {
  vscode.window.activeTextEditor =
    languageId === undefined
      ? undefined
      : createFakePartial<vscode.TextEditor>({ document: { languageId } });
}

describe('toggle code suggestions for language command', () => {
  beforeEach(() => {
    setActiveTextEditorLanguage(undefined);
    setDisabledLanguages([]);
  });

  it.each`
    disabledLanguages     | expected
    ${[]}                 | ${['java']}
    ${['java']}           | ${[]}
    ${['python']}         | ${['python', 'java']}
    ${['python', 'java']} | ${['python']}
    ${['Java']}           | ${[]}
    ${['python', 'JAVA']} | ${['python']}
  `(
    'toggles java given disabledLanguages=$disabledLanguages',
    async ({ disabledLanguages, expected }) => {
      setActiveTextEditorLanguage('java');
      setDisabledLanguages(disabledLanguages);

      await toggleCodeSuggestionsForLanguage();

      expect(setDuoCodeSuggestionsConfiguration).toHaveBeenCalledWith({
        disabledLanguages: expected,
      });
    },
  );

  it('gracefully handles no document', async () => {
    await expect(toggleCodeSuggestionsForLanguage()).resolves.toBe(undefined);

    expect(setDuoCodeSuggestionsConfiguration).not.toHaveBeenCalled();
  });
});
