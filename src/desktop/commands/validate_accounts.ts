import vscode from 'vscode';
import { currentUserRequest } from '../../common/gitlab/api/get_current_user';
import { accountService, isEnvAccount } from '../accounts/account_service';
import { getEnvCredentials } from '../utils/environment_configuration';
import { RefreshingGitLabService } from '../gitlab/refreshing_gitlab_service';
import { Account } from '../../common/platform/gitlab_account';
import { FetchError } from '../../common/errors/fetch_error';
import { log } from '../../common/log';
import { USER_COMMANDS as DESKTOP_COMMANDS } from '../command_names';
import { USER_COMMANDS as COMMON_COMMANDS } from '../../common/command_names';

const DELETE_AND_AUTH = 'Re-authenticate';
const IGNORE = 'Ignore Error';

/** ignored accounts are stored in memory and so after extension restarts, user needs to ignore them again */
const ignoredAccounts: string[] = [];

type AccountStatus = 'valid' | 'offline' | 'ignored' | 'invalid';

const validateAccount = async (
  account: Account,
  silentOffline: boolean,
): Promise<{ account: Account; status: AccountStatus }> => {
  const service = new RefreshingGitLabService(account);
  try {
    await service.fetchFromApi(currentUserRequest);
    return { account, status: 'valid' };
  } catch (e) {
    // GitLab only adds `invalid_token` for expired or revoked tokens; a mistyped token gets a bare 401.
    if (e instanceof FetchError && (e.isInvalidToken() || e.status === 401)) {
      if (ignoredAccounts.some(id => id === account.id)) {
        return { account, status: 'ignored' };
      }
      if (isEnvAccount(account)) {
        // Re-authenticating can't help: the account comes back from the environment on the next read.
        // A GITLAB_WORKFLOW_TOKEN_FILE token has already been copied into GITLAB_WORKFLOW_TOKEN.
        const workflowTokenVariable = process.env.GITLAB_WORKFLOW_TOKEN_FILE
          ? 'GITLAB_WORKFLOW_TOKEN or GITLAB_WORKFLOW_TOKEN_FILE'
          : 'GITLAB_WORKFLOW_TOKEN';
        const tokenVariable = getEnvCredentials()?.usesGitLabCliVariables
          ? 'GITLAB_TOKEN'
          : workflowTokenVariable;
        const choice = await vscode.window.showErrorMessage(
          `The token in the ${tokenVariable} environment variable for instance ${account.instanceUrl} is invalid, expired or revoked. Update the environment variable and restart VS Code.`,
          IGNORE,
        );
        if (choice === IGNORE) ignoredAccounts.push(account.id);
        return { account, status: 'invalid' };
      }
      const message = `The token for username ${account.username} on instance ${account.instanceUrl} has expired or been revoked.`;
      const choice = await vscode.window.showErrorMessage(message, DELETE_AND_AUTH, IGNORE);
      switch (choice) {
        case DELETE_AND_AUTH:
          await accountService.removeAccount(account.id);
          await vscode.commands.executeCommand(DESKTOP_COMMANDS.AUTHENTICATE, account.instanceUrl);
          break;
        case IGNORE:
          ignoredAccounts.push(account.id);
          break;
        default:
      }
      return { account, status: 'invalid' };
    }

    const message = `Account validation for username ${account.username} on instance ${account.instanceUrl} failed. The extension can't connect to the instance.`;
    log.error(message, e);
    if (!silentOffline) {
      const DELETE_ACCOUNT = 'Delete Account';
      const SHOW_LOGS = 'Show Logs';

      const response = await vscode.window.showErrorMessage(message, DELETE_ACCOUNT, SHOW_LOGS);
      switch (response) {
        case DELETE_ACCOUNT:
          await accountService.removeAccount(account.id);
          break;
        case SHOW_LOGS:
          await vscode.commands.executeCommand(COMMON_COMMANDS.SHOW_LOGS);
          break;
        default:
          break;
      }
    }
    return { account, status: 'offline' };
  }
};

/**
 * command to validate that accounts don't have expired tokens
 * @param quiet is used when we invoke the command during extension startup and we don't want to spam user with success messages
 */
export const validateAccounts = async (quiet = false) => {
  const accounts = accountService.getAllAccounts();
  const accountsWithStatus = await Promise.all(accounts.map(acc => validateAccount(acc, quiet)));

  if (quiet) {
    return;
  }

  if (accounts.length === 0) {
    const command = await vscode.window.showInformationMessage('No GitLab accounts are set up.', {
      title: 'Authenticate to GitLab',
      command: COMMON_COMMANDS.AUTHENTICATE,
    });

    if (command) {
      await vscode.commands.executeCommand(command.command);
    }
    return;
  }

  const ignored = accountsWithStatus.filter(a => a.status === 'ignored');
  await Promise.all(
    ignored.map(async i => {
      await vscode.window.showWarningMessage(
        `Account ${i.account.instanceUrl}(${i.account.username}) has issues but it's ignored for this session. Restart VS Code to stop ignoring it.`,
      );
    }),
  );
  if (accountsWithStatus.every(f => f.status === 'valid')) {
    await vscode.window.showInformationMessage('All accounts are valid!');
  }
};
