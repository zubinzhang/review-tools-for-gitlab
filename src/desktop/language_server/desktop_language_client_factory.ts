import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  Executable,
  NodeModule,
  LanguageClient,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { coerce, gte } from 'semver';
import {
  LANGUAGE_SERVER_ID,
  LANGUAGE_SERVER_NAME,
  LanguageClientFactory,
} from '../../common/language_server/client_factory';
import { extensionConfigurationService } from '../../common/utils/extension_configuration_service';
import { log } from '../../common/log';

function proxyEnv():
  | {
      http_proxy?: string | undefined;
      HTTPS_PROXY?: string | undefined;
      NO_PROXY?: string | undefined;
    }
  | undefined {
  const httpProxy: string =
    vscode.workspace.getConfiguration('http').get('proxy') || process.env.http_proxy || '';
  const httpsProxy: string =
    vscode.workspace.getConfiguration('http').get('proxy') || process.env.HTTPS_PROXY || '';
  const noProxy: string[] =
    vscode.workspace.getConfiguration('http').get('noProxy') ||
    process.env.NO_PROXY?.split(',') ||
    [];
  const env = {
    ...(httpProxy ? { http_proxy: httpProxy } : {}),
    ...(httpsProxy ? { HTTPS_PROXY: httpsProxy } : {}),
    ...(noProxy.length > 0 ? { NO_PROXY: noProxy.join(',') } : {}),
  };
  if (env.http_proxy === undefined && env.HTTPS_PROXY === undefined && env.NO_PROXY === undefined) {
    return undefined;
  }
  return env;
}

// Add --use-system-ca if supported by NodeJS runtime
const getUseSystemCA = (): string[] => {
  try {
    const parsedNodeJSVersion = coerce(process.version);

    if (!parsedNodeJSVersion) return [];
    if (gte(parsedNodeJSVersion, '22.15.0')) return ['--use-system-ca'];

    return [];
  } catch {
    return [];
  }
};

export const desktopLanguageClientFactory: LanguageClientFactory = {
  createLanguageClient(context, clientOptions) {
    // Must match packagedBinaryName in scripts/utils/lsp_binaries.mjs, which
    // packages the platform's compiled LS under this fixed name
    const binaryName = process.platform === 'win32' ? 'gitlab-lsp.exe' : 'gitlab-lsp';
    const binaryPath = context.asAbsolutePath(`./assets/language-server/${binaryName}`);
    if (fs.existsSync(binaryPath)) {
      // Some install paths can drop the exec bit preserved in the VSIX zip
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
      } catch {
        try {
          fs.chmodSync(binaryPath, 0o755);
        } catch (e) {
          log.error(
            `Failed to restore the exec bit on the language server binary at ${binaryPath}`,
            e as Error,
          );
        }
      }

      log.info(`Language Server: using compiled binary at ${binaryPath}`);

      // The child env replaces process.env entirely, so it must be merged back in.
      // --use-system-ca is compiled into the binary; Node execArgv does not apply.
      const executable: Executable = {
        command: binaryPath,
        args: ['--stdio'],
        options: { env: { ...process.env, ...(proxyEnv() ?? {}) } },
      };

      return new LanguageClient(
        LANGUAGE_SERVER_ID,
        LANGUAGE_SERVER_NAME,
        { run: executable, debug: executable } satisfies ServerOptions,
        clientOptions,
      );
    }

    // We handle two main bundle locations here for transition period
    // see https://gitlab.com/gitlab-org/editor-extensions/gitlab-lsp/-/issues/1461 for status.
    // Once the LS main desktop bundle output path is changed, we can remove the fallback path
    const nodeBundlePath = context.asAbsolutePath('./assets/language-server/main-bundle-node.js');
    const fallbackBundlePath = context.asAbsolutePath(
      './assets/language-server/node/main-bundle.js',
    );

    const bundlePath = fs.existsSync(nodeBundlePath) ? nodeBundlePath : fallbackBundlePath;
    log.info(`Language Server: using Node.js bundle at ${bundlePath}`);

    const exec: NodeModule = {
      module: bundlePath,
      transport: TransportKind.stdio,
    };

    const runArgs = extensionConfigurationService.getConfiguration().debug
      ? ['--use-source-maps']
      : []; // this initializes source maps for stack trace

    const env = proxyEnv();
    const options = env?.HTTPS_PROXY || env?.http_proxy ? { env } : undefined;
    const execArgv = getUseSystemCA();

    const serverOptions: ServerOptions = {
      debug: {
        ...exec,
        args: runArgs,
        options: {
          ...options,
          execArgv: ['--nolazy', '--inspect=6010', ...execArgv],
        },
      },
      run: {
        ...exec,
        args: runArgs,
        options: {
          ...options,
          execArgv: [...execArgv],
        },
      },
    };

    return new LanguageClient(
      LANGUAGE_SERVER_ID,
      LANGUAGE_SERVER_NAME,
      serverOptions,
      clientOptions,
    );
  },
};
