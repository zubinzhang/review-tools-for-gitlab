import * as fs from 'fs';
import * as vscode from 'vscode';
import { LanguageClient, ServerOptions, Executable, NodeModule } from 'vscode-languageclient/node';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import {
  LANGUAGE_SERVER_ID,
  LANGUAGE_SERVER_NAME,
} from '../../common/language_server/client_factory';
import {
  ExtensionConfiguration,
  extensionConfigurationService,
} from '../../common/utils/extension_configuration_service';
import { desktopLanguageClientFactory } from './desktop_language_client_factory';

jest.mock('fs');
jest.mock('vscode-languageclient/node', () => ({
  LanguageClient: jest.fn(),
  TransportKind: { stdio: 0 },
}));
jest.mock('../../common/utils/extension_configuration_service');

describe('desktopLanguageClientFactory', () => {
  const context = createFakePartial<vscode.ExtensionContext>({
    asAbsolutePath: (p: string) => `/ext/${p}`,
  });
  const clientOptions = {};

  const getConfiguration = (values: Record<string, unknown> = {}) =>
    createFakePartial<vscode.WorkspaceConfiguration>({
      get: (key: string) => values[key],
    });

  beforeEach(() => {
    jest.mocked(vscode.workspace.getConfiguration).mockReturnValue(getConfiguration());
    jest
      .mocked(extensionConfigurationService.getConfiguration)
      .mockReturnValue(createFakePartial<ExtensionConfiguration>({ debug: false }));
  });

  const lastServerOptions = (): ServerOptions => {
    const { calls } = jest.mocked(LanguageClient).mock;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(LANGUAGE_SERVER_ID);
    expect(calls[0][1]).toBe(LANGUAGE_SERVER_NAME);
    expect(calls[0][3]).toBe(clientOptions);
    return calls[0][2] as ServerOptions;
  };

  const binaryName = process.platform === 'win32' ? 'gitlab-lsp.exe' : 'gitlab-lsp';

  describe('with a compiled LS binary in the extension assets', () => {
    beforeEach(() => {
      jest
        .mocked(fs.existsSync)
        .mockImplementation(p => String(p).endsWith(`/assets/language-server/${binaryName}`));
    });

    it('spawns the binary with --stdio and the full process env merged with proxy settings', () => {
      process.env.GITLAB_LSP_FACTORY_TEST = 'inherited';
      jest
        .mocked(vscode.workspace.getConfiguration)
        .mockReturnValue(getConfiguration({ proxy: 'http://proxy:8080' }));

      try {
        desktopLanguageClientFactory.createLanguageClient(context, clientOptions);
      } finally {
        delete process.env.GITLAB_LSP_FACTORY_TEST;
      }

      const serverOptions = lastServerOptions() as { run: Executable; debug: Executable };
      expect(serverOptions.run.command).toBe(`/ext/./assets/language-server/${binaryName}`);
      expect(serverOptions.run.args).toEqual(['--stdio']);
      expect(serverOptions.run.options?.env).toMatchObject({
        GITLAB_LSP_FACTORY_TEST: 'inherited',
        http_proxy: 'http://proxy:8080',
        HTTPS_PROXY: 'http://proxy:8080',
      });
      expect(serverOptions.debug).toBe(serverOptions.run);
    });

    it('restores the exec bit when the binary is not executable', () => {
      jest.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error('EACCES');
      });

      desktopLanguageClientFactory.createLanguageClient(context, clientOptions);

      const serverOptions = lastServerOptions() as { run: Executable };
      expect(fs.chmodSync).toHaveBeenCalledWith(serverOptions.run.command, 0o755);
    });

    it('still spawns the binary when the exec bit cannot be restored', () => {
      jest.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      jest.mocked(fs.chmodSync).mockImplementation(() => {
        throw new Error('EROFS');
      });

      desktopLanguageClientFactory.createLanguageClient(context, clientOptions);

      const serverOptions = lastServerOptions() as { run: Executable };
      expect(serverOptions.run.command).toBe(`/ext/./assets/language-server/${binaryName}`);
    });
  });

  describe('without a compiled LS binary', () => {
    it('runs the node bundle', () => {
      jest.mocked(fs.existsSync).mockImplementation(p => String(p).endsWith('main-bundle-node.js'));

      desktopLanguageClientFactory.createLanguageClient(context, clientOptions);

      const serverOptions = lastServerOptions() as { run: NodeModule };
      expect(serverOptions.run.module).toBe('/ext/./assets/language-server/main-bundle-node.js');
      expect(fs.chmodSync).not.toHaveBeenCalled();
    });
  });
});
