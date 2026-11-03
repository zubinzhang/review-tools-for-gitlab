import * as vscode from 'vscode';
import { createFakeWorkspaceConfiguration } from '../../test_utils/vscode_fakes';
import { ConfigInspectionResult } from './rename_ai_assist_to_duo';
import { migrateLanguageSettings } from './migrate_language_settings';

const DISABLED_LANGUAGES_KEY = 'gitlab.duoCodeSuggestions.disabledLanguages';
const OLD_KEYS = [
  'gitlab.duoCodeSuggestions.enabledSupportedLanguages',
  'gitlab.duoCodeSuggestions.additionalLanguages',
  'gitlab.aiAssistedCodeSuggestions.enabledSupportedLanguages',
  'gitlab.aiAssistedCodeSuggestions.additionalLanguages',
];

describe('migrateLanguageSettings', () => {
  let mockConfig: vscode.WorkspaceConfiguration;

  function mockWorkspaceConfiguration(
    config: Partial<vscode.WorkspaceConfiguration>,
    inspectionProperty: string,
  ) {
    mockConfig = createFakeWorkspaceConfiguration(config);
    jest.mocked(mockConfig.update).mockResolvedValue(undefined);
    jest.mocked(mockConfig.inspect).mockImplementation(key => {
      if (config[key] === undefined) return undefined;
      return { [inspectionProperty]: config[key] } as ConfigInspectionResult;
    });

    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(mockConfig);
  }

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe.each([
    { configurationTarget: vscode.ConfigurationTarget.Global, inspectionProperty: 'globalValue' },
    {
      configurationTarget: vscode.ConfigurationTarget.Workspace,
      inspectionProperty: 'workspaceValue',
    },
    {
      configurationTarget: vscode.ConfigurationTarget.WorkspaceFolder,
      inspectionProperty: 'workspaceFolderValue',
    },
  ])('for "$inspectionProperty" config', ({ configurationTarget, inspectionProperty }) => {
    it('converts unchecked languages from both namespaces and removes the old settings', async () => {
      mockWorkspaceConfiguration(
        {
          'gitlab.duoCodeSuggestions.enabledSupportedLanguages': { python: false, go: true },
          'gitlab.aiAssistedCodeSuggestions.enabledSupportedLanguages': { ruby: false },
          'gitlab.duoCodeSuggestions.additionalLanguages': ['lua'],
          'gitlab.aiAssistedCodeSuggestions.additionalLanguages': ['dart'],
        },
        inspectionProperty,
      );

      await migrateLanguageSettings();

      expect(mockConfig.update).toHaveBeenCalledWith(
        DISABLED_LANGUAGES_KEY,
        ['python', 'ruby'],
        configurationTarget,
      );
      OLD_KEYS.forEach(key => {
        expect(mockConfig.update).toHaveBeenCalledWith(key, undefined, configurationTarget);
      });
      expect(mockConfig.update).toHaveBeenCalledTimes(5);
    });

    it('merges unchecked languages into an existing disabledLanguages value', async () => {
      mockWorkspaceConfiguration(
        {
          'gitlab.duoCodeSuggestions.enabledSupportedLanguages': { python: false },
          [DISABLED_LANGUAGES_KEY]: ['lua', 'python'],
        },
        inspectionProperty,
      );

      await migrateLanguageSettings();

      expect(mockConfig.update).toHaveBeenCalledWith(
        DISABLED_LANGUAGES_KEY,
        ['lua', 'python'],
        configurationTarget,
      );
    });

    it.each([{ python: true }, ['not', 'an', 'object']])(
      'removes %p without writing disabledLanguages',
      async value => {
        mockWorkspaceConfiguration(
          { 'gitlab.duoCodeSuggestions.enabledSupportedLanguages': value },
          inspectionProperty,
        );

        await migrateLanguageSettings();

        expect(mockConfig.update).toHaveBeenCalledTimes(1);
        expect(mockConfig.update).toHaveBeenCalledWith(
          'gitlab.duoCodeSuggestions.enabledSupportedLanguages',
          undefined,
          configurationTarget,
        );
      },
    );

    it('does not touch settings that are not set', async () => {
      mockWorkspaceConfiguration({}, inspectionProperty);

      await migrateLanguageSettings();

      expect(mockConfig.update).not.toHaveBeenCalled();
    });
  });
});
