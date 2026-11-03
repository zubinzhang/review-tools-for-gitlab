import { OAuthAccount, serializeAccountSafe } from './gitlab_account';

describe('accounts/gitlab_account', () => {
  describe('serializeAccountSafe', () => {
    it('includes the account ID and redacts the token without language-server helpers', () => {
      const account: OAuthAccount = {
        instanceUrl: 'https://example.com',
        id: 'https://example.com|777',
        username: 'paul',
        scopes: ['api'],
        type: 'oauth',
        expiresAtTimestampInSeconds: 1000,
        refreshToken: 'af123',
        token: 'be456',
      };
      expect(serializeAccountSafe(account)).toBe('(https://example.com|777 - [REDACTED])');
      expect(serializeAccountSafe(account)).not.toContain(account.token);
      expect(serializeAccountSafe(account)).not.toContain(account.refreshToken);
    });
  });
});
