import * as vscode from 'vscode';
import { createFakePartial } from '../test_utils/create_fake_partial';
import { DUO_CODE_SUGGESTIONS_CONFIG_NAMESPACE } from '../code_suggestions/constants';
import { createFakeWorkspaceConfiguration } from '../test_utils/vscode_fakes';
import {
  setDuoCodeSuggestionsConfiguration,
  setDuoSandboxConfiguration,
  getDuoCodeSuggestionsConfiguration,
  getAgentPlatformConfiguration,
  getDuoSandboxConfiguration,
} from './extension_configuration';

describe('utils/extension_configuration', () => {
  describe('setDuoCodeSuggestionsConfiguration', () => {
    let mockAiConfig: vscode.WorkspaceConfiguration;

    beforeEach(() => {
      mockAiConfig = createFakePartial<vscode.WorkspaceConfiguration>({
        update: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockReturnValue(undefined),
      });

      jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockAiConfig);
    });

    it('requests AI config', async () => {
      expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();

      await setDuoCodeSuggestionsConfiguration({
        enabled: true,
      });

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
        DUO_CODE_SUGGESTIONS_CONFIG_NAMESPACE,
      );
    });

    it.each`
      config                            | mockInspect                  | expectedUpdate
      ${{ enabled: true }}              | ${undefined}                 | ${[['enabled', true, vscode.ConfigurationTarget.Global]]}
      ${{ enabled: false }}             | ${{ workspaceValue: false }} | ${[['enabled', false, vscode.ConfigurationTarget.Workspace]]}
      ${{ disabledLanguages: ['foo'] }} | ${undefined}                 | ${[['disabledLanguages', ['foo'], vscode.ConfigurationTarget.Global]]}
    `(
      'with config=$config and inspect=$mockInspect, should update',
      async ({ config, mockInspect, expectedUpdate }) => {
        jest.mocked(mockAiConfig.inspect).mockReturnValue(mockInspect);
        expect(mockAiConfig.update).not.toHaveBeenCalled();

        await setDuoCodeSuggestionsConfiguration(config);

        expect(jest.mocked(mockAiConfig.update).mock.calls).toEqual(expectedUpdate);
      },
    );
  });

  describe('getDuoCodeSuggestionsConfiguration', () => {
    describe('given valid values', () => {
      beforeEach(() => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
          createFakeWorkspaceConfiguration({
            enabled: true,
            suggestionsCache: undefined,
            disabledLanguages: ['foo'],
            openTabsContext: true,
          }),
        );
      });

      it('return the values', () => {
        expect(getDuoCodeSuggestionsConfiguration()).toEqual({
          enabled: true,
          suggestionsCache: undefined,
          disabledLanguages: ['foo'],
          openTabsContext: true,
        });
      });
    });

    describe('given invalid values', () => {
      beforeEach(() => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
          createFakeWorkspaceConfiguration({
            enabled: 'true',
            suggestionsCache: undefined,
            disabledLanguages: 'foo,bar',
            openTabsContext: 'false',
          }),
        );
      });

      it('returns sensible default values', () => {
        expect(getDuoCodeSuggestionsConfiguration()).toEqual({
          enabled: true,
          suggestionsCache: undefined,
          disabledLanguages: [],
          openTabsContext: true,
        });
      });
    });
  });

  describe('getAgentPlatformConfiguration', () => {
    describe('given valid values', () => {
      beforeEach(() => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
          createFakeWorkspaceConfiguration({
            enabled: false,
          }),
        );
      });

      it('should return the configured value', () => {
        expect(getAgentPlatformConfiguration()).toEqual(
          expect.objectContaining({
            enabled: false,
          }),
        );
      });
    });

    describe('given invalid values', () => {
      beforeEach(() => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
          createFakeWorkspaceConfiguration({
            enabled: 'false',
          }),
        );
      });

      it('should return default value when configuration is invalid', () => {
        expect(getAgentPlatformConfiguration()).toEqual(
          expect.objectContaining({
            enabled: true,
          }),
        );
      });
    });

    describe('given undefined values', () => {
      beforeEach(() => {
        jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
          createFakeWorkspaceConfiguration({
            enabled: undefined,
          }),
        );
      });

      it('should return default value when configuration is undefined', () => {
        expect(getAgentPlatformConfiguration()).toEqual(
          expect.objectContaining({
            enabled: true,
          }),
        );
      });
    });

    describe.each([
      { editFileDiffBehavior: undefined, expected: 'foreground' },
      { editFileDiffBehavior: 'foreground', expected: 'foreground' },
      { editFileDiffBehavior: 'background', expected: 'background' },
      { editFileDiffBehavior: 'none', expected: 'none' },
    ])(
      'given editFileDiffBehavior: $editFileDiffBehavior',
      ({ editFileDiffBehavior, expected }) => {
        it('should return the configured editFileDiffBehavior', () => {
          jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(
            createFakeWorkspaceConfiguration({
              enabled: true,
              editFileDiffBehavior,
            }),
          );

          expect(getAgentPlatformConfiguration()).toEqual({
            enabled: true,
            editFileDiffBehavior: expected,
          });
        });
      },
    );
  });

  describe('setDuoSandboxConfiguration', () => {
    let mockSandboxConfig: vscode.WorkspaceConfiguration;

    beforeEach(() => {
      mockSandboxConfig = createFakePartial<vscode.WorkspaceConfiguration>({
        update: jest.fn().mockResolvedValue(undefined),
        inspect: jest.fn().mockReturnValue(undefined),
      });
      jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockSandboxConfig);
    });

    it('updates the enabled key with the given value', async () => {
      await setDuoSandboxConfiguration({ enabled: true });

      expect(mockSandboxConfig.update).toHaveBeenCalledWith(
        'enabled',
        true,
        vscode.ConfigurationTarget.Global,
      );
    });

    it('updates to false when disabled', async () => {
      await setDuoSandboxConfiguration({ enabled: false });

      expect(mockSandboxConfig.update).toHaveBeenCalledWith(
        'enabled',
        false,
        vscode.ConfigurationTarget.Global,
      );
    });

    it.each([{ workspaceValue: true }, { workspaceFolderValue: true }])(
      'writes user settings even when the workspace has a value (%o)',
      async inspection => {
        jest.mocked(mockSandboxConfig.inspect).mockReturnValue({ key: 'enabled', ...inspection });

        await setDuoSandboxConfiguration({ enabled: false });

        expect(mockSandboxConfig.update).toHaveBeenCalledWith(
          'enabled',
          false,
          vscode.ConfigurationTarget.Global,
        );
      },
    );
  });

  describe('getDuoSandboxConfiguration', () => {
    type Inspection = Omit<
      NonNullable<ReturnType<vscode.WorkspaceConfiguration['inspect']>>,
      'key'
    >;

    const mockInspection = (inspection: Inspection | undefined, merged?: unknown) => {
      const config = createFakeWorkspaceConfiguration({ enabled: merged });
      jest.mocked(config.inspect).mockReturnValue(inspection && { key: 'enabled', ...inspection });
      jest.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce(config);
    };

    it.each([
      { globalValue: true, expected: true },
      { globalValue: false, expected: false },
    ])('returns the user value ($globalValue)', ({ globalValue, expected }) => {
      mockInspection({ globalValue });

      expect(getDuoSandboxConfiguration()).toEqual({ enabled: expected });
    });

    it.each([
      { globalValue: true, workspaceValue: false, merged: false, expected: true },
      { globalValue: true, workspaceFolderValue: false, merged: false, expected: true },
      { globalValue: undefined, workspaceValue: true, merged: true, expected: false },
      { globalValue: false, workspaceFolderValue: true, merged: true, expected: false },
    ])('ignores workspace values (%o)', ({ merged, expected, ...inspection }) => {
      mockInspection(inspection, merged);

      expect(getDuoSandboxConfiguration()).toEqual({ enabled: expected });
    });

    it.each([
      { case: 'undefined', globalValue: undefined },
      { case: 'null', globalValue: null },
      { case: 'a string', globalValue: 'true' },
      { case: 'a number', globalValue: 1 },
      { case: 'an object', globalValue: { enabled: true } },
    ])('defaults to false when the user value is $case', ({ globalValue }) => {
      mockInspection({ globalValue });

      expect(getDuoSandboxConfiguration()).toEqual({ enabled: false });
    });

    it('defaults to false when inspect returns nothing', () => {
      mockInspection(undefined, true);

      expect(getDuoSandboxConfiguration()).toEqual({ enabled: false });
    });
  });
});
