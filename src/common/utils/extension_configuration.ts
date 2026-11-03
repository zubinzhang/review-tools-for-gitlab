import * as vscode from 'vscode';
import { CONFIG_NAMESPACE } from '../constants';
import { DUO_CODE_SUGGESTIONS_CONFIG_NAMESPACE } from '../code_suggestions/constants';
import { SECURITY_SCANNER_NAMESPACE } from '../security_scans/constants';
import { isArrayOfString, isBoolean } from './type_predicates';
import { getConfigurationTargetForKey } from './get_configuration_target_for_key';

// These constants represent `settings.json` keys. Other constants belong to `constants.ts`.
export const GITLAB_DEBUG_MODE = 'gitlab.debug';
export const DUO_CODE_SUGGESTIONS_MODE = 'gitlab.duoCodeSuggestions.enabled';
export const DUO_CODE_SUGGESTIONS_DISABLED_LANGUAGES =
  'gitlab.duoCodeSuggestions.disabledLanguages';

export const DUO_ENABLE_WITHOUT_GITLAB_PROJECT = 'gitlab.duo.enabledWithoutGitlabProject';
export const GITLAB_BRANCH_PROTECTION = 'gitlab.branchProtection';
export const GITLAB_SHOW_CLOSED_MRS = 'gitlab.showClosedMergeRequests';
export const DUO_CHAT_CONFIG_NAMESPACE = 'gitlab.duoChat';
export const DUO_AGENT_PLATFORM_CONFIG_NAMESPACE = 'gitlab.duoAgentPlatform';
export const DUO_SANDBOX_CONFIG_NAMESPACE = 'gitlab.duoAgentPlatform.sandbox';

export type DuoWorkflowConfiguration = Record<string, never>;

export interface DuoAgentPlatformConfiguration {
  enabled: boolean;
  editFileDiffBehavior: 'foreground' | 'background' | 'none';
}

export interface DuoSandboxConfiguration {
  enabled: boolean;
}

export interface DuoProxyConfiguration {
  directConnection: boolean;
}

export interface DuoConfiguration {
  enabledWithoutGitLabProject: boolean;
  workflow: DuoWorkflowConfiguration;
  agentPlatform: DuoAgentPlatformConfiguration;
  sandbox: DuoSandboxConfiguration;
  proxy: DuoProxyConfiguration;
}

export interface DuoChatConfiguration {
  enabled: boolean;
}

export interface DuoCodeSuggestionsConfiguration {
  enabled: boolean;
  suggestionsCache?: object; // Optional as does not define contributes.configuration
  disabledLanguages: string[];
  openTabsContext: boolean;
}

export interface httpAgentConfiguration {
  ca?: string;
  cert?: string;
  certKey?: string;
}

export interface SecurityScannerConfiguration {
  enabled: boolean;
  scanFileOnSave: boolean;
}

// VS Code returns a value or `null` but undefined is better for using default function arguments
export function turnNullToUndefined<T>(val: T | null | undefined): T | undefined {
  return val ?? undefined;
}

const booleanOrDefault = (val: unknown, defaultValue: boolean): boolean =>
  isBoolean(val) ? val : defaultValue;

const stringArrayOrEmpty = (val: unknown): string[] => (isArrayOfString(val) ? val : []);

export function getDuoCodeSuggestionsConfiguration(): DuoCodeSuggestionsConfiguration {
  const duoCodeSuggestionsConfig = vscode.workspace.getConfiguration(
    DUO_CODE_SUGGESTIONS_CONFIG_NAMESPACE,
  );

  return {
    enabled: booleanOrDefault(duoCodeSuggestionsConfig.enabled, true),
    suggestionsCache: duoCodeSuggestionsConfig.suggestionsCache,
    disabledLanguages: stringArrayOrEmpty(duoCodeSuggestionsConfig.disabledLanguages),
    openTabsContext: booleanOrDefault(duoCodeSuggestionsConfig.openTabsContext, true),
  };
}

export function getAgentPlatformConfiguration(): DuoAgentPlatformConfiguration {
  const duoAgentPlatformConfig = vscode.workspace.getConfiguration(
    DUO_AGENT_PLATFORM_CONFIG_NAMESPACE,
  );

  return {
    enabled: booleanOrDefault(duoAgentPlatformConfig.enabled, true),
    editFileDiffBehavior: duoAgentPlatformConfig.editFileDiffBehavior ?? 'foreground',
  };
}

export function getDuoSandboxConfiguration(): DuoSandboxConfiguration {
  // Only the user value counts, so repository settings can't turn the sandbox off or on.
  const inspection = vscode.workspace
    .getConfiguration(DUO_SANDBOX_CONFIG_NAMESPACE)
    .inspect('enabled');
  return {
    enabled: booleanOrDefault(inspection?.globalValue, false),
  };
}

export function getDuoChatConfiguration(): DuoChatConfiguration {
  const duoChatConfig = vscode.workspace.getConfiguration(DUO_CHAT_CONFIG_NAMESPACE);
  return {
    enabled: booleanOrDefault(duoChatConfig.enabled, true),
  };
}

export function getSecurityScannerConfiguration(): SecurityScannerConfiguration {
  const securityScannerConfig = vscode.workspace.getConfiguration(SECURITY_SCANNER_NAMESPACE);
  return {
    enabled: securityScannerConfig.enabled ?? false,
    scanFileOnSave: securityScannerConfig.scanFileOnSave,
  };
}

export function getHttpAgentConfiguration(): httpAgentConfiguration {
  const workspaceConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return {
    ca: workspaceConfig.ca,
    cert: workspaceConfig.cert,
    certKey: workspaceConfig.certKey,
  };
}

/**
 * Calls `config.update` but uses `getConfigurationTargetForKey` to make
 * sure we pick the right ConfigurationTarget
 */
export const updateConfig = <T>(config: vscode.WorkspaceConfiguration, key: string, value: T) => {
  const target = getConfigurationTargetForKey(config, key);
  return config.update(key, value, target);
};

/**
 * Set 'gitlab.duoCodeSuggestions' configuration values from the given object.
 *
 * To remove a configuration key, use `undefined` as the value. This behavior
 * comes from the underlying `WorkspaceConfiguration#update` method.
 *
 * To avoid unnecessary writes to user and/or workspace configuration files,
 * only provide object properties for settings that will actually change. In
 * other words:
 *
 *     // Bad
 *     setDuoCodeSuggestionsConfiguration({
 *       ...getDuoCodeSuggestionsConfiguration(),
 *       foo,
 *       bar,
 *     })
 *
 *     // Good
 *     setDuoCodeSuggestionsConfiguration({
 *       foo,
 *       bar,
 *     })
 */
export async function setDuoCodeSuggestionsConfiguration(
  config: Partial<DuoCodeSuggestionsConfiguration>,
) {
  const duoCodeSuggestionsConfig = vscode.workspace.getConfiguration(
    DUO_CODE_SUGGESTIONS_CONFIG_NAMESPACE,
  );

  for (const [key, value] of Object.entries(config)) {
    // eslint-disable-next-line no-await-in-loop
    await updateConfig(duoCodeSuggestionsConfig, key, value);
  }
}

export async function setDuoSandboxConfiguration(config: Partial<DuoSandboxConfiguration>) {
  const duoSandboxConfig = vscode.workspace.getConfiguration(DUO_SANDBOX_CONFIG_NAMESPACE);
  for (const [key, value] of Object.entries(config)) {
    // eslint-disable-next-line no-await-in-loop
    await duoSandboxConfig.update(key, value, vscode.ConfigurationTarget.Global);
  }
}
