import { removeTrailingSlash } from './remove_trailing_slash';

export interface EnvCredentials {
  instanceUrl: string;
  token: string;
  /** True for the glab-style `GITLAB_HOST`/`GITLAB_TOKEN` pair, false for `GITLAB_WORKFLOW_*`. */
  usesGitLabCliVariables: boolean;
}

// Values from MDM, secret mounts or `$(cat file)` often carry stray whitespace or a trailing newline.
const readEnv = (name: string): string | undefined => process.env[name]?.trim() || undefined;

/** glab accepts a bare host name in GITLAB_HOST, so default to https and match the instance picker's URL form. */
export const normalizeGitLabHost = (host: string): string => {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `https://${host}`;
  try {
    return removeTrailingSlash(new URL(withScheme).toString());
  } catch {
    return removeTrailingSlash(withScheme);
  }
};

const getWorkflowInstanceUrl = () => {
  const url = readEnv('GITLAB_WORKFLOW_INSTANCE_URL');
  return url && removeTrailingSlash(url);
};

const getGitLabHostUrl = () => {
  const host = readEnv('GITLAB_HOST');
  return host && normalizeGitLabHost(host);
};

export const getEnvInstanceUrl = (): string | undefined =>
  getWorkflowInstanceUrl() ?? getGitLabHostUrl();

/**
 * Each set is used only as a complete pair, so a token is never sent to a host from the other set.
 * GITLAB_WORKFLOW_TOKEN_FILE is resolved into GITLAB_WORKFLOW_TOKEN during AccountService.init.
 */
export const getEnvCredentials = (): EnvCredentials | undefined => {
  const workflowInstanceUrl = getWorkflowInstanceUrl();
  const workflowToken = readEnv('GITLAB_WORKFLOW_TOKEN');
  if (workflowInstanceUrl && workflowToken) {
    return {
      instanceUrl: workflowInstanceUrl,
      token: workflowToken,
      usesGitLabCliVariables: false,
    };
  }
  const hostUrl = getGitLabHostUrl();
  const token = readEnv('GITLAB_TOKEN');
  // A token alone never defaults to gitlab.com: many shells export GITLAB_TOKEN for glab already.
  if (hostUrl && token) {
    return { instanceUrl: hostUrl, token, usesGitLabCliVariables: true };
  }
  return undefined;
};
