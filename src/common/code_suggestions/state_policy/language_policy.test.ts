import * as vscode from 'vscode';
import { createFakePartial } from '../../test_utils/create_fake_partial';
import {
  createActiveTextEditorChangeTrigger,
  createConfigurationChangeTrigger,
} from '../../test_utils/vscode_fakes';
import {
  DuoCodeSuggestionsConfiguration,
  getDuoCodeSuggestionsConfiguration,
} from '../../utils/extension_configuration';
import { DISABLED_LANGUAGE_VIA_SETTINGS, LanguagePolicy } from './language_policy';

jest.mock('../../utils/extension_configuration');

const editorFor = (languageId: string) =>
  createFakePartial<vscode.TextEditor>({ document: { languageId } });

describe('LanguagePolicy', () => {
  let policy: LanguagePolicy;
  const triggerActiveTextEditorChange = createActiveTextEditorChangeTrigger();
  const triggerConfigurationChange = createConfigurationChangeTrigger();

  const setDisabledLanguages = (disabledLanguages: string[]) =>
    jest
      .mocked(getDuoCodeSuggestionsConfiguration)
      .mockReturnValue(createFakePartial<DuoCodeSuggestionsConfiguration>({ disabledLanguages }));

  beforeEach(async () => {
    setDisabledLanguages(['python']);
    vscode.window.activeTextEditor = undefined;
    policy = new LanguagePolicy();
    await policy.init();
  });

  afterEach(() => policy.dispose());

  it('has DISABLED_LANGUAGE_VIA_SETTINGS state', () => {
    expect(policy.state).toBe(DISABLED_LANGUAGE_VIA_SETTINGS);
  });

  it('is not engaged without an active editor', () => {
    expect(policy.engaged).toBe(false);
  });

  it.each`
    languageId      | engaged
    ${'python'}     | ${true}
    ${'javascript'} | ${false}
  `('is engaged=$engaged for $languageId', async ({ languageId, engaged }) => {
    await triggerActiveTextEditorChange(editorFor(languageId));

    expect(policy.engaged).toBe(engaged);
  });

  it('is engaged when the setting entry differs in case from the language id', async () => {
    setDisabledLanguages(['Python']);
    await triggerActiveTextEditorChange(editorFor('python'));

    expect(policy.engaged).toBe(true);
  });

  it('re-evaluates the active editor when the setting changes', async () => {
    vscode.window.activeTextEditor = editorFor('javascript');
    await triggerActiveTextEditorChange(editorFor('javascript'));
    expect(policy.engaged).toBe(false);

    setDisabledLanguages(['javascript']);
    await triggerConfigurationChange();

    expect(policy.engaged).toBe(true);
  });

  describe('onEngagedChange', () => {
    const listener = jest.fn();

    beforeEach(() => {
      listener.mockClear();
      policy.onEngagedChange(listener);
    });

    it('fires only when engaged changes', async () => {
      await triggerActiveTextEditorChange(editorFor('javascript'));
      expect(listener).not.toHaveBeenCalled();

      await triggerActiveTextEditorChange(editorFor('python'));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(true);

      await triggerActiveTextEditorChange(editorFor('python'));
      expect(listener).toHaveBeenCalledTimes(1);

      await triggerActiveTextEditorChange(editorFor('ruby'));
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith(false);
    });
  });
});
