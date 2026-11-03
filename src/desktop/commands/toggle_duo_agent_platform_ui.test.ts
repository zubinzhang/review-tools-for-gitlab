import * as vscode from 'vscode';
import { WebviewMessageRegistry } from '../../common/webview/message_handlers';
import { AGENT_PLATFORM_V2_WEBVIEW_ID } from '../../common/constants';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import {
  isDuoAgentPlatformSurveyHidden,
  setDuoAgentPlatformNewUi,
} from '../../common/feature_flags/duo_agent_platform_new_ui_context';
import { createToggleDuoAgentPlatformUiCommand } from './toggle_duo_agent_platform_ui';

jest.mock('../../common/feature_flags/duo_agent_platform_new_ui_context');

describe('createToggleDuoAgentPlatformUiCommand', () => {
  let switchHandler: ((payload: unknown) => Promise<void> | void) | undefined;
  let sendNotification: jest.Mock;
  let registry: WebviewMessageRegistry;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    jest.mocked(isDuoAgentPlatformSurveyHidden).mockReturnValue(false);
    switchHandler = undefined;
    sendNotification = jest.fn().mockResolvedValue(undefined);
    registry = createFakePartial<WebviewMessageRegistry>({
      sendNotification,
      onNotification: jest.fn((_webviewId, messageId, handler) => {
        if (messageId === 'switchToClassicLayout') switchHandler = handler;
      }),
    });
    context = createFakePartial<vscode.ExtensionContext>({});
  });

  const create = () => createToggleDuoAgentPlatformUiCommand(registry, context);

  it('asks the new-UI webview to show the survey instead of switching immediately', async () => {
    await create()();

    expect(sendNotification).toHaveBeenCalledWith(
      AGENT_PLATFORM_V2_WEBVIEW_ID,
      'showLayoutFeedbackSurvey',
      undefined,
    );
    expect(setDuoAgentPlatformNewUi).not.toHaveBeenCalled();
  });

  it('skips the survey and switches straight away when the user has opted out', async () => {
    jest.mocked(isDuoAgentPlatformSurveyHidden).mockReturnValue(true);

    await create()();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(setDuoAgentPlatformNewUi).toHaveBeenCalledWith(context, false, true);
  });

  it('switches to the classic layout once the webview signals the survey is done', async () => {
    create();

    await switchHandler?.({ hideSurvey: true });

    expect(setDuoAgentPlatformNewUi).toHaveBeenCalledWith(context, false, true);
  });

  it('keeps the survey enabled when the webview dismisses without opting out', async () => {
    create();

    await switchHandler?.({ hideSurvey: false });

    expect(setDuoAgentPlatformNewUi).toHaveBeenCalledWith(context, false, false);
  });
});
