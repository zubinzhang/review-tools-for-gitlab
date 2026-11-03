import { SettingsDetails } from '../state/settings_state_provider';
import {
  DuoChatConfiguration,
  DuoCodeSuggestionsConfiguration,
  DuoAgentPlatformConfiguration,
  httpAgentConfiguration,
  SecurityScannerConfiguration,
} from '../utils/extension_configuration';
import { ExtensionConfiguration } from '../utils/extension_configuration_service';
import { createFakePartial } from './create_fake_partial';

export const createMockSettingsDetails = (): SettingsDetails => ({
  extensionConfiguration: createFakePartial<ExtensionConfiguration>({
    duo: {
      enabledWithoutGitLabProject: false,
      workflow: {},
    },
    debug: false,
    ignoreCertificateErrors: false,
    pipelineGitRemoteName: 'origin',
  }),
  duoCodeSuggestionsConfiguration: createFakePartial<DuoCodeSuggestionsConfiguration>({
    enabled: true,
    openTabsContext: true,
  }),
  duoChatConfiguration: createFakePartial<DuoChatConfiguration>({
    enabled: true,
  }),
  duoAgentPlatformConfiguration: createFakePartial<DuoAgentPlatformConfiguration>({
    enabled: true,
    editFileDiffBehavior: 'foreground',
  }),
  httpProxyConfiguration: createFakePartial<httpAgentConfiguration>({
    ca: 'ca-cert',
    cert: 'cert-file',
    certKey: 'cert-key',
  }),
  securityScannerConfiguration: createFakePartial<SecurityScannerConfiguration>({
    enabled: true,
    scanFileOnSave: true,
  }),
});
