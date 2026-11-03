import { ExtensionContext } from 'vscode';
import { AccountService } from '../accounts/account_service';
import { createOAuthAccount, createTokenAccount } from '../test_utils/entities';
import { createExtensionContext } from '../../common/test_utils/entities';
import { BUNDLED_CLIENT_IDS } from '../utils/extension_configuration';
import { GITLAB_COM_URL } from '../../common/constants';
import { createExpiresTimestamp, GitLabService } from './gitlab_service';
import { TokenExchangeService } from './token_exchange_service';

jest.mock('./gitlab_service');

const unixTimestampNow = () => Math.floor(new Date().getTime() / 1000);

describe('TokenExchangeService', () => {
  describe('refreshing token', () => {
    let extensionContext: ExtensionContext;
    let accountService: AccountService;
    let tokenExchangeService: TokenExchangeService;
    const tokenExpiresIn = 7200;

    beforeEach(async () => {
      accountService = new AccountService();
      extensionContext = createExtensionContext();
      await accountService.init(extensionContext);
      tokenExchangeService = new TokenExchangeService(accountService);
      jest
        .mocked(createExpiresTimestamp)
        .mockImplementation(jest.requireActual('./gitlab_service').createExpiresTimestamp);
    });
    it('returns unchanged TokenAccount', async () => {
      const tokenAccount = createTokenAccount();
      await accountService.addAccount(tokenAccount);

      const result = await tokenExchangeService.refreshIfNeeded(tokenAccount.id);

      expect(result).toEqual(tokenAccount);
    });

    it('returns valid OAuth account without change', async () => {
      const oauthAccount = createOAuthAccount();
      await accountService.addAccount(oauthAccount);

      const result = await tokenExchangeService.refreshIfNeeded(oauthAccount.id);

      expect(result).toEqual(oauthAccount);
    });

    it('refreshes expired OAuth account', async () => {
      const timestampNow = unixTimestampNow();

      const expiredAccount = {
        ...createOAuthAccount(),
        refreshToken: 'def',
        codeVerifier: 'abc',
        expiresAtTimestampInSeconds: timestampNow - 60, // expired 60s ago
      };
      await accountService.addAccount(expiredAccount);
      // mock API token refresh response
      jest.mocked(GitLabService.exchangeToken).mockResolvedValue({
        access_token: 'new_token',
        refresh_token: 'new_refresh_token',
        expires_in: tokenExpiresIn,
        created_at: timestampNow,
      });

      const result = await tokenExchangeService.refreshIfNeeded(expiredAccount.id);

      // account has been refreshed
      expect(result).toEqual({
        ...expiredAccount,
        refreshToken: 'new_refresh_token',
        token: 'new_token',
        expiresAtTimestampInSeconds: timestampNow + tokenExpiresIn,
      });
      // verify that we called API with correct parameters
      const { refreshToken, instanceUrl } = expiredAccount;
      expect(GitLabService.exchangeToken).toHaveBeenCalledWith(
        {
          grantType: 'refresh_token',
          refreshToken,
          instanceUrl,
        },
        BUNDLED_CLIENT_IDS[GITLAB_COM_URL],
      );
    });

    it('refreshes with the client ID stored on the account, even when it is no longer configured', async () => {
      const timestampNow = unixTimestampNow();
      const expiredAccount = {
        ...createOAuthAccount('https://gitlab.example.com'),
        clientId: 'stored-client-id',
        expiresAtTimestampInSeconds: timestampNow - 60,
      };
      await accountService.addAccount(expiredAccount);
      jest.mocked(GitLabService.exchangeToken).mockResolvedValue({
        access_token: 'new_token',
        refresh_token: 'new_refresh_token',
        expires_in: tokenExpiresIn,
        created_at: timestampNow,
      });

      const result = await tokenExchangeService.refreshIfNeeded(expiredAccount.id);

      expect(GitLabService.exchangeToken).toHaveBeenCalledWith(
        expect.objectContaining({ grantType: 'refresh_token' }),
        'stored-client-id',
      );
      expect(result).toMatchObject({ clientId: 'stored-client-id', token: 'new_token' });
    });

    // Refresh tokens are bound to the client that issued them.
    it('prefers the stored client ID over a different configured one', async () => {
      const timestampNow = unixTimestampNow();
      const expiredAccount = {
        ...createOAuthAccount(GITLAB_COM_URL),
        clientId: 'stored-client-id',
        expiresAtTimestampInSeconds: timestampNow - 60,
      };
      await accountService.addAccount(expiredAccount);
      jest.mocked(GitLabService.exchangeToken).mockResolvedValue({
        access_token: 'new_token',
        refresh_token: 'new_refresh_token',
        expires_in: tokenExpiresIn,
        created_at: timestampNow,
      });

      await tokenExchangeService.refreshIfNeeded(expiredAccount.id);

      expect(BUNDLED_CLIENT_IDS[GITLAB_COM_URL]).not.toBe('stored-client-id');
      expect(GitLabService.exchangeToken).toHaveBeenCalledWith(
        expect.objectContaining({ grantType: 'refresh_token' }),
        'stored-client-id',
      );
    });

    it('names the client ID setting when none is configured', async () => {
      const expiredAccount = {
        ...createOAuthAccount('https://gitlab.example.com'),
        expiresAtTimestampInSeconds: unixTimestampNow() - 60,
      };
      await accountService.addAccount(expiredAccount);

      const refresh = tokenExchangeService.refreshIfNeeded(expiredAccount.id);
      await expect(refresh).rejects.toThrow(/gitlab\.authentication\.oauthClientIds/);
      await expect(refresh).rejects.not.toThrow(/GITLAB_CLIENT_ID/);
    });

    it('reloads secrets from OS Keychain before refreshing expired OAuth account', async () => {
      const timestampNow = unixTimestampNow();

      const expiredAccount = {
        ...createOAuthAccount(),
        refreshToken: 'def',
        codeVerifier: 'abc',
        expiresAtTimestampInSeconds: timestampNow - 60, // expired 60s ago
      };
      await accountService.addAccount(expiredAccount);

      // simulate another VS Code instance on the OS refreshing the token
      const secondAccountService = new AccountService();
      await secondAccountService.init(extensionContext);
      await secondAccountService.updateAccountSecret({
        ...expiredAccount,
        token: 'new_token',
        refreshToken: 'new_refresh_token',
        expiresAtTimestampInSeconds: timestampNow + tokenExpiresIn,
      });

      const result = await tokenExchangeService.refreshIfNeeded(expiredAccount.id);

      // refreshed account has been loaded from the secure storage
      expect(result).toEqual({
        ...expiredAccount,
        refreshToken: 'new_refresh_token',
        token: 'new_token',
        expiresAtTimestampInSeconds: timestampNow + tokenExpiresIn,
      });
      expect(GitLabService.exchangeToken).not.toHaveBeenCalled();
    });
  });
});
