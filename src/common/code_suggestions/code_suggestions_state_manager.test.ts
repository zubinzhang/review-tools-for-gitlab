import * as vscode from 'vscode';
import {
  createConfigurationChangeTrigger,
  createFakeWorkspaceConfiguration,
} from '../test_utils/vscode_fakes';
import { createFakePartial } from '../test_utils/create_fake_partial';
import { GitLabPlatformManager } from '../platform/gitlab_platform';
import { createExtensionContext, gitlabPlatformForProject } from '../test_utils/entities';
import { waitForMs } from '../utils/wait_for_ms';
import { LanguageServerFeatureStateProvider } from '../language_server/language_server_feature_state_provider';
import {
  CodeSuggestionsStateManager,
  VisibleCodeSuggestionsState,
} from './code_suggestions_state_manager';
import { GitLabPlatformManagerForCodeSuggestionsImpl } from './gitlab_platform_manager_for_code_suggestions';
import { disabledForSessionPolicy } from './state_policy/disabled_for_session_policy';
import { StatePolicy } from './state_policy/state_policy';
import { createFakePolicy } from './state_policy/test_utils/create_fake_policy';
import { MissingAccountPolicy } from './state_policy/missing_account_policy';
import { LanguageServerPolicy } from './state_policy/language_server_policy';
import { LanguagePolicy } from './state_policy/language_policy';

jest.mock('./gitlab_platform_manager_for_code_suggestions', () => ({
  GitLabPlatformManagerForCodeSuggestionsImpl: jest.fn(),
}));
jest.mock('./state_policy/language_server_policy.ts');
jest.mock('./state_policy/language_policy.ts');
jest.mock('./state_policy/missing_account_policy.ts');
jest.useFakeTimers();

describe('Code suggestions state manager', () => {
  let triggerSettingsRefresh: () => void;
  let stateManager: CodeSuggestionsStateManager;
  let platformManager: GitLabPlatformManager;
  let suggestionsPlatformManager: GitLabPlatformManagerForCodeSuggestionsImpl;
  let languageServerPolicyMock: StatePolicy;
  let languagePolicyMock: StatePolicy;
  let missingAccountPolicyMock: StatePolicy;
  let featureStateProvider: LanguageServerFeatureStateProvider;
  const context = createExtensionContext();
  let mockedPolicies: StatePolicy[] = [];

  beforeEach(async () => {
    platformManager = createFakePartial<GitLabPlatformManager>({});

    languageServerPolicyMock = createFakePolicy(
      VisibleCodeSuggestionsState.SUGGESTIONS_FILE_EXCLUDED,
    );
    languagePolicyMock = createFakePolicy(
      jest.requireActual('./state_policy/language_policy').DISABLED_LANGUAGE_VIA_SETTINGS,
    );
    missingAccountPolicyMock = createFakePolicy(
      jest.requireActual('./state_policy/missing_account_policy').NO_ACCOUNT,
    );

    jest
      .mocked(MissingAccountPolicy)
      .mockReturnValue(missingAccountPolicyMock as MissingAccountPolicy);
    jest
      .mocked(LanguageServerPolicy)
      .mockReturnValue(languageServerPolicyMock as LanguageServerPolicy);
    jest.mocked(LanguagePolicy).mockReturnValue(languagePolicyMock as LanguagePolicy);

    // these triggers need to be created BEFORE state manager adds listeners to VS Code API
    triggerSettingsRefresh = createConfigurationChangeTrigger();

    // ensure the suggestions are enabled in settings
    jest
      .mocked(vscode.workspace.getConfiguration)
      .mockReturnValue(createFakeWorkspaceConfiguration({ enabled: true }));

    // pretend there is a GitLab account
    suggestionsPlatformManager = createFakePartial<GitLabPlatformManagerForCodeSuggestionsImpl>({
      getGitLabPlatform: jest.fn().mockResolvedValue(gitlabPlatformForProject),
      dispose: () => {},
    });
    jest
      .mocked(GitLabPlatformManagerForCodeSuggestionsImpl)
      .mockReturnValue(suggestionsPlatformManager);

    featureStateProvider = createFakePartial<LanguageServerFeatureStateProvider>({
      setStates: jest.fn(),
    });

    mockedPolicies = [languageServerPolicyMock, languagePolicyMock, missingAccountPolicyMock];

    stateManager = new CodeSuggestionsStateManager(platformManager, context, featureStateProvider);
    disabledForSessionPolicy.setTemporaryDisabled(false);
    await stateManager.init();
  });

  afterEach(() => {
    stateManager.dispose();
  });

  const disableViaSettings = () => {
    jest
      .mocked(vscode.workspace.getConfiguration)
      .mockReturnValue(createFakeWorkspaceConfiguration({ enabled: false }));
    triggerSettingsRefresh();
  };

  describe('constructor', () => {
    it('reads settings and sets the disabled in settings property', () => {
      jest
        .mocked(vscode.workspace.getConfiguration)
        .mockReturnValue(createFakeWorkspaceConfiguration({ enabled: false }));

      stateManager = new CodeSuggestionsStateManager(
        platformManager,
        context,
        featureStateProvider,
      );

      expect(stateManager.getVisibleState()).toBe(
        VisibleCodeSuggestionsState.DISABLED_VIA_SETTINGS,
      );
    });
  });

  describe('init', () => {
    it('if a policy initialization fails, the init does not crash', async () => {
      languageServerPolicyMock.init = jest.fn().mockRejectedValue(new Error('init error'));

      stateManager = new CodeSuggestionsStateManager(
        platformManager,
        context,
        featureStateProvider,
      );

      await expect(stateManager.init()).resolves.not.toThrow();
    });

    it('the visible state is updated when policy initialization completes successfully', async () => {
      const visibleStateChangeListener = jest.fn();
      // Have a policy that returns early, and engages
      missingAccountPolicyMock.init = jest.fn(async () => {
        missingAccountPolicyMock.engaged = true;
      });
      // Have a policy that returns late
      languageServerPolicyMock.init = jest.fn(async () => {
        await waitForMs(100);
      });

      stateManager = new CodeSuggestionsStateManager(
        platformManager,
        context,
        featureStateProvider,
      );
      stateManager.onDidChangeVisibleState(visibleStateChangeListener);
      const getVisibleStateSpy = jest.spyOn(stateManager, 'getVisibleState');

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      stateManager.init();
      await jest.advanceTimersByTimeAsync(100);

      expect(getVisibleStateSpy).toHaveBeenCalledTimes(1);
      expect(visibleStateChangeListener).toHaveBeenCalledWith(
        VisibleCodeSuggestionsState.NO_ACCOUNT,
      );
    });
  });

  describe('visible state', () => {
    type StateMutation = () => void | Promise<void>;
    const mutationsFromLeastImportant: {
      mutation: StateMutation;
      expectedState: VisibleCodeSuggestionsState;
    }[] = [
      {
        mutation: () => stateManager.setLoading(true),
        expectedState: VisibleCodeSuggestionsState.LOADING,
      },
      {
        mutation: () => stateManager.setError(true),
        expectedState: VisibleCodeSuggestionsState.ERROR,
      },
      {
        mutation: () => disabledForSessionPolicy.setTemporaryDisabled(true),
        expectedState: VisibleCodeSuggestionsState.DISABLED_BY_USER,
      },
      {
        mutation: disableViaSettings,
        expectedState: VisibleCodeSuggestionsState.DISABLED_VIA_SETTINGS,
      },
    ];

    const lsPolicy = {
      mutation: async () => {
        languageServerPolicyMock.engaged = true;
        jest.mocked(languageServerPolicyMock.onEngagedChange).mock.calls[0][0](true);
      },
      expectedState: VisibleCodeSuggestionsState.SUGGESTIONS_FILE_EXCLUDED,
    };

    const languagePolicy = {
      mutation: async () => {
        languagePolicyMock.engaged = true;
        jest.mocked(languagePolicyMock.onEngagedChange).mock.calls[0][0](true);
      },
      expectedState: VisibleCodeSuggestionsState.DISABLED_LANGUAGE_VIA_SETTINGS,
    };

    const getMissingAccountPolicy = () => {
      return {
        mutation: async () => {
          missingAccountPolicyMock.engaged = true;
          jest.mocked(missingAccountPolicyMock.onEngagedChange).mock.calls[0][0](true);
        },
        expectedState: VisibleCodeSuggestionsState.NO_ACCOUNT,
      };
    };

    let mutations: {
      mutation: StateMutation;
      expectedState: VisibleCodeSuggestionsState;
    }[];

    beforeEach(async () => {
      mockedPolicies.forEach(policy => {
        jest.mocked(policy).onEngagedChange.mockClear();
      });
      const accountPolicy = getMissingAccountPolicy();
      const lsPolicies = [lsPolicy, languagePolicy, accountPolicy];

      mutations = [...mutationsFromLeastImportant];
      mutations.splice(2, 0, ...lsPolicies);

      stateManager = new CodeSuggestionsStateManager(
        platformManager,
        context,
        featureStateProvider,
      );
      await stateManager.init();
    });

    it('more important state takes precedence over less important state', async () => {
      expect(stateManager.getVisibleState()).toBe(VisibleCodeSuggestionsState.READY);

      for (const scenario of mutations) {
        // we want to ensure that we execute the mutations in series
        // eslint-disable-next-line no-await-in-loop
        await scenario.mutation();
        expect(stateManager.getVisibleState()).toBe(scenario.expectedState);
      }
    });

    it('every state change triggers an event', async () => {
      const visibleStateChangeListener = jest.fn();
      stateManager.onDidChangeVisibleState(visibleStateChangeListener);
      for (const scenario of mutations) {
        visibleStateChangeListener.mockReset();
        // we want to ensure that we execute the mutations in series
        // eslint-disable-next-line no-await-in-loop
        await scenario.mutation();
        expect(visibleStateChangeListener).toHaveBeenCalledWith(scenario.expectedState);
      }
    });
  });

  describe('Loading state', () => {
    it('handles parallel operations', () => {
      stateManager.setLoading(true);
      stateManager.setLoading(true);
      stateManager.setLoading(false);

      expect(stateManager.getVisibleState()).toBe(VisibleCodeSuggestionsState.LOADING);

      stateManager.setLoading(false);

      expect(stateManager.getVisibleState()).toBe(VisibleCodeSuggestionsState.READY);
    });

    it('can never enter negative loading', () => {
      stateManager.setLoading(true);
      stateManager.setLoading(false);
      stateManager.setLoading(false);
      stateManager.setLoading(false);

      expect(stateManager.getVisibleState()).toBe(VisibleCodeSuggestionsState.READY);

      stateManager.setLoading(true);

      expect(stateManager.getVisibleState()).toBe(VisibleCodeSuggestionsState.LOADING);
    });
  });

  describe('disabled & active', () => {
    let disabledByUserListener: jest.Func;

    beforeEach(async () => {
      disabledByUserListener = jest.fn();
      stateManager.onDidChangeDisabledByUserState(disabledByUserListener);
      await stateManager.init();
    });

    it('by default is not disabled and it is active', async () => {
      expect(stateManager.isDisabledByUser()).toBe(false);
      expect(stateManager.isActive()).toBe(true);
    });

    it('changes to disabled and inactive when disabling via settings', () => {
      disableViaSettings();

      expect(stateManager.isDisabledByUser()).toBe(true);
      expect(disabledByUserListener).toHaveBeenCalledWith(true);

      expect(stateManager.isActive()).toBe(false);
    });

    it('changes to disabled and inactive when disabling temporarily for session', () => {
      disabledForSessionPolicy.setTemporaryDisabled(true);

      expect(stateManager.isDisabledByUser()).toBe(true);
      expect(disabledByUserListener).toHaveBeenCalledWith(true);

      expect(stateManager.isActive()).toBe(false);
    });
  });
});
