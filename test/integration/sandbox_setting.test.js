const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {
  DUO_SANDBOX_CONFIG_NAMESPACE,
  getDuoSandboxConfiguration,
} = require('../../src/common/utils/extension_configuration');
const {
  ExtensionConfigurationService,
} = require('../../src/common/utils/extension_configuration_service');
const { getRepositoryRoot } = require('./test_infrastructure/helpers');

// A sentinel change guarantees a configuration event even when VS Code ignores the payload.
const SENTINEL = 'editor.tabSize';

const sentinelValue = () => vscode.workspace.getConfiguration().inspect(SENTINEL)?.workspaceValue;

const waitForSentinel = expected =>
  new Promise((resolve, reject) => {
    let timeout;
    const listener = vscode.workspace.onDidChangeConfiguration(() => {
      if (sentinelValue() !== expected) return;
      clearTimeout(timeout);
      listener.dispose();
      resolve();
    });
    timeout = setTimeout(() => {
      listener.dispose();
      reject(new Error(`VS Code did not load ${SENTINEL}=${expected} from workspace settings`));
    }, 4000);
  });

describe('Sandbox setting', () => {
  const settingsPath = path.join(getRepositoryRoot(), '.vscode', 'settings.json');
  const sandboxConfig = () => vscode.workspace.getConfiguration(DUO_SANDBOX_CONFIG_NAMESPACE);
  const setUserValue = value =>
    sandboxConfig().update('enabled', value, vscode.ConfigurationTarget.Global);
  let originalSettings;
  let originalUserValue;
  let service;
  let emittedSandboxValues = [];
  let nextSentinel = 10;

  const writeWorkspaceSettings = async payload => {
    nextSentinel += 1;
    const loaded = waitForSentinel(nextSentinel);
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...JSON.parse(originalSettings), ...payload, [SENTINEL]: nextSentinel }),
    );
    await loaded;
  };

  before(async () => {
    originalSettings = fs.readFileSync(settingsPath, 'utf8');
    originalUserValue = sandboxConfig().inspect('enabled')?.globalValue;
    service = new ExtensionConfigurationService();
    service.onChange(config => emittedSandboxValues.push(config.duo.sandbox.enabled));
  });

  afterEach(async function restore() {
    this.timeout(10000);
    if (fs.readFileSync(settingsPath, 'utf8') === originalSettings) return;
    const loaded = waitForSentinel(JSON.parse(originalSettings)[SENTINEL]);
    fs.writeFileSync(settingsPath, originalSettings);
    await loaded;
  });

  after(async () => {
    service.dispose();
    await setUserValue(originalUserValue);
  });

  describe('with the sandbox enabled in user settings', () => {
    beforeEach(async () => {
      await setUserValue(true);
      emittedSandboxValues = [];
    });

    [
      { 'gitlab.duoAgentPlatform.sandbox.enabled': false },
      { 'gitlab.duoAgentPlatform.sandbox': false },
      { 'gitlab.duoAgentPlatform.sandbox': null },
      { 'gitlab.duoAgentPlatform.sandbox': { enabled: false } },
      { 'gitlab.duoAgentPlatform': { sandbox: { enabled: false } } },
    ].forEach(payload => {
      it(`ignores workspace payload ${JSON.stringify(payload)}`, async function test() {
        this.timeout(10000);
        await writeWorkspaceSettings(payload);

        assert.strictEqual(getDuoSandboxConfiguration().enabled, true);
        assert.strictEqual(service.getConfiguration().duo.sandbox.enabled, true);
        assert.ok(
          emittedSandboxValues.every(enabled => enabled === true),
          emittedSandboxValues,
        );
      });
    });

    // Unregistered ancestor keys reach the merged config, so the service must re-emit after the write.
    it('emits the user value when an ancestor key changes', async function test() {
      this.timeout(10000);
      await writeWorkspaceSettings({ 'gitlab.duoAgentPlatform': { sandbox: { enabled: false } } });

      assert.ok(emittedSandboxValues.length > 0, 'expected a configuration change event');
      assert.ok(
        emittedSandboxValues.every(enabled => enabled === true),
        emittedSandboxValues,
      );
    });
  });

  describe('with no sandbox value in user settings', () => {
    beforeEach(async () => {
      await setUserValue(undefined);
      emittedSandboxValues = [];
    });

    [
      { 'gitlab.duoAgentPlatform.sandbox.enabled': true },
      { 'gitlab.duoAgentPlatform.sandbox': { enabled: true } },
      { 'gitlab.duoAgentPlatform': { sandbox: { enabled: true } } },
    ].forEach(payload => {
      it(`does not let workspace payload ${JSON.stringify(payload)} enable the sandbox`, async function test() {
        this.timeout(10000);
        await writeWorkspaceSettings(payload);

        assert.strictEqual(getDuoSandboxConfiguration().enabled, false);
        assert.strictEqual(service.getConfiguration().duo.sandbox.enabled, false);
        assert.ok(
          emittedSandboxValues.every(enabled => enabled === false),
          emittedSandboxValues,
        );
      });
    });
  });
});
