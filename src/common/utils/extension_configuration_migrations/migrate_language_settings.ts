import * as vscode from 'vscode';
import { log } from '../../log';
import { isArrayOfString, isRecordOfStringBoolean } from '../type_predicates';
import { ConfigTarget, getConfigTargets } from './rename_ai_assist_to_duo';

const DISABLED_LANGUAGES_KEY = 'gitlab.duoCodeSuggestions.disabledLanguages';
const NAMESPACES = ['gitlab.duoCodeSuggestions', 'gitlab.aiAssistedCodeSuggestions'];

type DisabledLanguagesForTarget = {
  target: vscode.ConfigurationTarget;
  languages: Set<string>;
};

export async function migrateLanguageSettings() {
  const config = vscode.workspace.getConfiguration();
  const disabledByTarget = new Map<ConfigTarget['targetProperty'], DisabledLanguagesForTarget>();
  const updates: Thenable<void>[] = [];

  NAMESPACES.forEach(namespace => {
    const enabledSupportedLanguagesKey = `${namespace}.enabledSupportedLanguages`;
    inspectTargets(config, enabledSupportedLanguagesKey).forEach(configTarget => {
      collectDisabledLanguages(disabledByTarget, configTarget);
      updates.push(removeSetting(config, enabledSupportedLanguagesKey, configTarget));
    });

    const additionalLanguagesKey = `${namespace}.additionalLanguages`;
    inspectTargets(config, additionalLanguagesKey).forEach(configTarget => {
      updates.push(removeSetting(config, additionalLanguagesKey, configTarget));
    });
  });

  const existing = config.inspect(DISABLED_LANGUAGES_KEY);
  disabledByTarget.forEach(({ target, languages }, targetProperty) => {
    const current = existing?.[targetProperty];
    const merged = Array.from(
      new Set([...(isArrayOfString(current) ? current : []), ...languages]),
    );
    log.info(
      `Config migration: setting "${DISABLED_LANGUAGES_KEY}" to "${merged}" in configuration target "${targetProperty}"`,
    );
    updates.push(config.update(DISABLED_LANGUAGES_KEY, merged, target));
  });

  await Promise.all(updates);
}

function collectDisabledLanguages(
  disabledByTarget: Map<ConfigTarget['targetProperty'], DisabledLanguagesForTarget>,
  { value, target, targetProperty }: ConfigTarget,
) {
  if (!isRecordOfStringBoolean(value)) return;

  const disabled = Object.keys(value).filter(language => !value[language]);
  if (disabled.length === 0) return;

  const entry = disabledByTarget.get(targetProperty) ?? { target, languages: new Set<string>() };
  disabled.forEach(language => entry.languages.add(language));
  disabledByTarget.set(targetProperty, entry);
}

function inspectTargets(config: vscode.WorkspaceConfiguration, key: string): ConfigTarget[] {
  const inspection = config.inspect(key);
  return inspection ? getConfigTargets(inspection) : [];
}

function removeSetting(
  config: vscode.WorkspaceConfiguration,
  key: string,
  { target, targetProperty }: ConfigTarget,
): Thenable<void> {
  log.info(
    `Config migration: removing deprecated config "${key}" from configuration target "${targetProperty}"`,
  );
  return config.update(key, undefined, target);
}
