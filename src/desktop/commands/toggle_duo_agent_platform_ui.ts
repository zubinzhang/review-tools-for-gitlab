import * as vscode from 'vscode';
import { WebviewMessageRegistry } from '../../common/webview/message_handlers';
import { AGENT_PLATFORM_V2_WEBVIEW_ID } from '../../common/constants';
import {
  isDuoAgentPlatformSurveyHidden,
  setDuoAgentPlatformNewUi,
} from '../../common/feature_flags/duo_agent_platform_new_ui_context';

type SwitchToClassicLayoutParams = { hideSurvey?: boolean };

// Switching back to the classic layout is gated on a short feedback survey rendered by the new
// UI itself: the command asks the webview to show the survey, and the webview signals
// `switchToClassicLayout` (optionally opting out of future surveys) once the user responds —
// only then do we flip the layout. Users who already opted out skip straight to the switch.
export const createToggleDuoAgentPlatformUiCommand = (
  webviewMessageRegistry: WebviewMessageRegistry,
  context: vscode.ExtensionContext,
) => {
  const switchToClassicLayout = (hideSurvey: boolean) =>
    setDuoAgentPlatformNewUi(context, false, hideSurvey);

  webviewMessageRegistry.onNotification(
    AGENT_PLATFORM_V2_WEBVIEW_ID,
    'switchToClassicLayout',
    payload => {
      const { hideSurvey = false } = (payload ?? {}) as SwitchToClassicLayoutParams;
      return switchToClassicLayout(hideSurvey);
    },
  );

  return () => {
    if (isDuoAgentPlatformSurveyHidden(context)) {
      return switchToClassicLayout(true);
    }

    return webviewMessageRegistry.sendNotification(
      AGENT_PLATFORM_V2_WEBVIEW_ID,
      'showLayoutFeedbackSurvey',
      undefined,
    );
  };
};
