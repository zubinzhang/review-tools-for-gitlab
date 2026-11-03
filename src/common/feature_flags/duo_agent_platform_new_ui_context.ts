import * as vscode from 'vscode';

// Drives which Agent Platform view renders. The new UI is the default; the
// disable command is an opt-out back to the v1 UI. Restored from globalState on activation so the choice survives
// window reloads.
const CONTEXT_KEY = 'gitlab:duoAgentPlatformNewUI';
const STORAGE_KEY = 'duoAgentPlatformNewUI';
// Persists the user opting out of the "why did you switch back" survey.
const HIDE_SURVEY_STORAGE_KEY = 'hideDuoAgentPlatformNewUISurvey';

const publish = (enabled: boolean) => {
  return vscode.commands.executeCommand('setContext', CONTEXT_KEY, enabled);
};

export const restoreDuoAgentPlatformNewUiContext = async (
  context: vscode.ExtensionContext,
): Promise<void> => {
  await publish(context.globalState.get(STORAGE_KEY, true));
};

export const setDuoAgentPlatformNewUi = async (
  context: vscode.ExtensionContext,
  enabled: boolean,
  hideSurvey = false,
): Promise<void> => {
  await context.globalState.update(STORAGE_KEY, enabled);
  if (hideSurvey) {
    await context.globalState.update(HIDE_SURVEY_STORAGE_KEY, true);
  }
  await publish(enabled);
};

export const isDuoAgentPlatformSurveyHidden = (context: vscode.ExtensionContext): boolean =>
  context.globalState.get(HIDE_SURVEY_STORAGE_KEY, false);
