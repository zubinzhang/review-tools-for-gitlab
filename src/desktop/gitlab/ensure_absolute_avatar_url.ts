import * as vscode from 'vscode';

export const ensureAbsoluteAvatarUrl = (instanceUrl: string, avatarUrl: string): string => {
  if (!avatarUrl.startsWith('/')) {
    return avatarUrl;
  }
  const queryIndex = avatarUrl.indexOf('?');
  const path = queryIndex === -1 ? avatarUrl : avatarUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : avatarUrl.slice(queryIndex + 1);
  return vscode.Uri.parse(instanceUrl).with({ path, query }).toString(true);
};
