import * as fs from 'fs';
import * as vscode from 'vscode';
import { UserFriendlyError } from '../../../common/errors/user_friendly_error';
import { handleError } from '../../../common/errors/handle_error';
import { isKeepAliveAffectedNodeVersion } from './is_keep_alive_affected_node_version';

export interface GitLabHttpAgentOptions {
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  proxy?: string;
  rejectUnauthorized?: boolean;
  keepAlive?: boolean;
}

export const getHttpAgentOptions = (): GitLabHttpAgentOptions => {
  // Disable keep-alive only for Node 24.17.x, which has a regression in http.Agent
  // keep-alive socket handling that breaks node-fetch v2 gzip/chunked responses.
  // See https://github.com/nodejs/node/issues/63989 and https://github.com/node-fetch/node-fetch/issues/1767
  const result: GitLabHttpAgentOptions = { keepAlive: !isKeepAliveAffectedNodeVersion() };
  // FIXME: if you are touching this configuration statement, move the configuration to extension_configuration.ts
  const { ignoreCertificateErrors, ca, cert, certKey } =
    vscode.workspace.getConfiguration('gitlab');

  result.rejectUnauthorized = !ignoreCertificateErrors;
  if (ca) {
    try {
      result.ca = fs.readFileSync(ca);
    } catch (e) {
      handleError(new UserFriendlyError(`Cannot read CA '${ca}'`, e));
    }
  }
  if (cert) {
    try {
      result.cert = fs.readFileSync(cert);
    } catch (e) {
      handleError(new UserFriendlyError(`Cannot read Certificate '${cert}'`, e));
    }
  }
  if (certKey) {
    try {
      result.key = fs.readFileSync(certKey);
    } catch (e) {
      handleError(new UserFriendlyError(`Cannot read Certificate Key '${certKey}'`, e));
    }
  }

  // FIXME: if you are touching this configuration statement, move the configuration to extension_configuration.ts
  const { proxy } = vscode.workspace.getConfiguration('http');
  result.proxy = proxy || undefined;
  return result;
};
