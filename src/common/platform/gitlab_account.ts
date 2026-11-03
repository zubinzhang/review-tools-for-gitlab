export interface Credentials {
  instanceUrl: string;
  token: string;
}

interface AccountBase extends Credentials {
  username: string;
  id: string;
}
export interface TokenAccount extends AccountBase {
  type: 'token';
}

export interface OAuthAccount extends AccountBase {
  type: 'oauth';
  scopes: string[];
  refreshToken: string;
  expiresAtTimestampInSeconds: number;
  /** The OAuth app that issued the refresh token; refresh must reuse it. Unset for accounts created before it was stored. */
  clientId?: string;
}

export type Account = TokenAccount | OAuthAccount;

export const serializeAccountSafe = (account: { id: string; token: string }) =>
  `(${account.id} - [REDACTED])`;

export const makeAccountId = (instanceUrl: string, userId: string | number) =>
  `${instanceUrl}|${userId}`;
