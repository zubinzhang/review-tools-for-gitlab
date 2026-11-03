import * as vscode from 'vscode';
import { createFakePartial } from '../test_utils/create_fake_partial';
import {
  isDuoAgentPlatformSurveyHidden,
  restoreDuoAgentPlatformNewUiContext,
  setDuoAgentPlatformNewUi,
} from './duo_agent_platform_new_ui_context';

const CONTEXT_KEY = 'gitlab:duoAgentPlatformNewUI';
const STORAGE_KEY = 'duoAgentPlatformNewUI';
const HIDE_SURVEY_STORAGE_KEY = 'hideDuoAgentPlatformNewUISurvey';

describe('duo agent platform new UI context', () => {
  const globalState = createFakePartial<vscode.Memento>({
    get: jest.fn(),
    update: jest.fn(),
  });
  const context = createFakePartial<vscode.ExtensionContext>({ globalState });

  beforeEach(() => {
    jest.mocked(vscode.commands.executeCommand).mockClear();
    jest.mocked(globalState.get).mockReset();
    jest.mocked(globalState.update).mockReset();
  });

  describe('restoreDuoAgentPlatformNewUiContext', () => {
    it.each([true, false])('publishes the stored value (%s)', async stored => {
      jest.mocked(globalState.get).mockReturnValue(stored);

      await restoreDuoAgentPlatformNewUiContext(context);

      expect(globalState.get).toHaveBeenCalledWith(STORAGE_KEY, true);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        CONTEXT_KEY,
        stored,
      );
    });

    it('publishes the default (true) when nothing has been persisted', async () => {
      jest.mocked(globalState.get).mockImplementation((_key, defaultValue) => defaultValue);

      await restoreDuoAgentPlatformNewUiContext(context);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', CONTEXT_KEY, true);
    });
  });

  describe('setDuoAgentPlatformNewUi', () => {
    it.each([true, false])('persists and publishes %s', async enabled => {
      await setDuoAgentPlatformNewUi(context, enabled);

      expect(globalState.update).toHaveBeenCalledWith(STORAGE_KEY, enabled);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        CONTEXT_KEY,
        enabled,
      );
    });

    it('does not touch the survey opt-out flag by default', async () => {
      await setDuoAgentPlatformNewUi(context, false);

      expect(globalState.update).not.toHaveBeenCalledWith(HIDE_SURVEY_STORAGE_KEY, true);
    });

    it('persists the survey opt-out flag when requested', async () => {
      await setDuoAgentPlatformNewUi(context, false, true);

      expect(globalState.update).toHaveBeenCalledWith(HIDE_SURVEY_STORAGE_KEY, true);
    });
  });

  describe('isDuoAgentPlatformSurveyHidden', () => {
    it.each([true, false])('reflects the persisted opt-out flag (%s)', hidden => {
      jest.mocked(globalState.get).mockReturnValue(hidden);

      expect(isDuoAgentPlatformSurveyHidden(context)).toBe(hidden);
      expect(globalState.get).toHaveBeenCalledWith(HIDE_SURVEY_STORAGE_KEY, false);
    });
  });
});
