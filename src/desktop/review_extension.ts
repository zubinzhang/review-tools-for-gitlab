import * as path from 'node:path';
import * as vscode from 'vscode';
import { initializeLogging } from '../common/log';
import { handleError } from '../common/errors/handle_error';
import { createShowOutputCommand } from '../common/show_output_command';
import { USER_COMMANDS as COMMON_USER_COMMANDS } from '../common/command_names';
import { wrapCommandWithCatch } from '../common/utils/wrap_command_with_catch';
import { REVIEW_URI_SCHEME } from './constants';
import { USER_COMMANDS, PROGRAMMATIC_COMMANDS } from './command_names';
import { initializeNetworkAgent } from './fetch';
import { contextUtils } from './utils/context_utils';
import { validateInstanceUrl } from './utils/validate_instance_url';
import { accountService } from './accounts/account_service';
import { createPatFlow } from './accounts/auth_flows/pat_flow';
import { removeAccount } from './accounts/remove_account';
import { validateAccounts } from './commands/validate_accounts';
import { AccountStatusBarItem } from './accounts/account_status_bar_item';
import { AccountPreselectionService } from './accounts/account_preselection_service';
import {
  getWorkspaceAccountManager,
  initWorkspaceAccountManager,
} from './accounts/workspace_account_manager';
import { createSelectWorkspaceAccountCommand } from './accounts/select_workspace_account_command';
import { createDeselectWorkspaceAccountCommand } from './accounts/deselect_workspace_account_command';
import { gitExtensionWrapper } from './git/git_extension_wrapper';
import {
  GitLabProjectRepositoryImpl,
  getProjectRepository,
  setGlobalProjectRepository,
} from './gitlab/gitlab_project_repository';
import { selectedProjectStore } from './gitlab/selected_project_store';
import {
  assignProject,
  clearSelectedProjects,
  selectProjectCommand,
  selectProjectForRepository,
} from './gitlab/select_project';
import { ExtensionState, setExtensionStateSingleton } from './extension_state';
import { IssuableDataProvider } from './tree_view/issuable_data_provider';
import { setupViewedCheckboxes } from './tree_view/viewed_checkbox_handler';
import { setSidebarViewState, SidebarViewState } from './tree_view/sidebar_view_state';
import { issuableController } from './issuable_controller';
import { ReviewFileSystem } from './review/review_file_system';
import { viewedFilesStore } from './review/viewed_files_store';
import { viewedDecorationProvider } from './review/viewed_decoration_provider';
import { changeTypeDecorationProvider } from './review/change_type_decoration_provider';
import { hasCommentsDecorationProvider } from './review/has_comments_decoration_provider';
import { commentControllerProvider } from './review/comment_controller_provider';
import {
  registerRepositoryRootProvider,
  runWithValidProject,
} from './commands/run_with_valid_project';
import { showMergeRequestSearchInput } from './search_input';
import { openCurrentMergeRequest, openCommitInGitLab, showMergeRequests } from './commands/openers';
import { openInGitLab, copyLinkToClipboard } from './commands/open_in_gitlab';
import { checkoutMrBranch } from './commands/checkout_mr_branch';
import { GitExtension } from './api/git';
import { ReviewWorktreeManager } from './review/review_worktree';
import { ReviewWorkspace } from './review/review_workspace';
import { ReviewCacheCleanup } from './review/review_cache_cleanup';
import { ReviewNavigation, PREPARE_REVIEW_NAVIGATION } from './review/review_navigation';
import {
  toggleResolved,
  deleteComment,
  editComment,
  cancelEdit,
  submitEdit,
  createComment,
  cancelFailedComment,
  retryFailedComment,
} from './commands/mr_discussion_commands';

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Review Tools for GitLab');
  initializeLogging(line => outputChannel.appendLine(line));
  initializeNetworkAgent();
  contextUtils.init(context);
  selectedProjectStore.init(context);
  viewedFilesStore.init(context);
  issuableController.init(context);
  registerRepositoryRootProvider(issuableController);

  await accountService.init(context);
  initWorkspaceAccountManager(context, accountService);
  const workspaceAccounts = getWorkspaceAccountManager();
  const projects = new GitLabProjectRepositoryImpl(
    accountService,
    gitExtensionWrapper,
    selectedProjectStore,
    workspaceAccounts,
  );
  setGlobalProjectRepository(projects);
  const state = new ExtensionState(workspaceAccounts);
  setExtensionStateSingleton(state);
  await state.init();

  const reviewStorage = vscode.Uri.joinPath(context.globalStorageUri, 'review-worktrees').fsPath;
  const previousReviewStorages = [
    path.join(
      path.dirname(context.globalStorageUri.fsPath),
      'zubinzhang.gitlab-review',
      'review-worktrees',
    ),
  ];
  const reviewWorkspace = new ReviewWorkspace(reviewStorage, previousReviewStorages);
  await reviewWorkspace.deduplicate();
  const provider = new IssuableDataProvider(
    state,
    repository => !reviewWorkspace.isReviewRoot(repository.rootFsPath),
  );
  const tree = vscode.window.createTreeView('gitlabReview.mergeRequests', {
    treeDataProvider: provider,
  });
  context.subscriptions.push(
    outputChannel,
    reviewWorkspace.listen(),
    gitExtensionWrapper,
    tree,
    setupViewedCheckboxes(tree, viewedDecorationProvider),
    new AccountStatusBarItem(workspaceAccounts),
    new AccountPreselectionService(workspaceAccounts, gitExtensionWrapper),
    vscode.workspace.registerFileSystemProvider(
      REVIEW_URI_SCHEME,
      new ReviewFileSystem(),
      ReviewFileSystem.OPTIONS,
    ),
    vscode.window.registerFileDecorationProvider(viewedDecorationProvider),
    vscode.window.registerFileDecorationProvider(changeTypeDecorationProvider),
    vscode.window.registerFileDecorationProvider(hasCommentsDecorationProvider),
    new vscode.Disposable(() => {
      Object.values(commentControllerProvider.controllers).forEach(controller =>
        controller?.dispose(),
      );
    }),
  );

  const gitPath =
    vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports.getAPI(1).git.path ?? 'git';
  const worktrees = new ReviewWorktreeManager(reviewStorage, gitPath, previousReviewStorages);
  const cleanup = new ReviewCacheCleanup(worktrees, reviewWorkspace);
  cleanup.run().catch(handleError);
  const navigation = new ReviewNavigation(worktrees, undefined, undefined, reviewWorkspace);
  context.subscriptions.push(
    tree.onDidChangeVisibility(event => {
      if (event.visible) cleanup.run().catch(handleError);
    }),
    navigation.listen(),
    vscode.languages.registerDefinitionProvider({ scheme: REVIEW_URI_SCHEME }, navigation),
    vscode.languages.registerImplementationProvider({ scheme: REVIEW_URI_SCHEME }, navigation),
    vscode.languages.registerHoverProvider({ scheme: REVIEW_URI_SCHEME }, navigation),
  );

  const commands = {
    [PREPARE_REVIEW_NAVIGATION]: navigation.prepare.bind(navigation),
    [USER_COMMANDS.AUTHENTICATE]: async (previousInstanceUrl?: string) => {
      const instanceUrl =
        previousInstanceUrl ??
        (await vscode.window.showInputBox({
          title: 'Review Tools for GitLab: Instance URL',
          prompt: 'GitLab instance URL, including http:// or https://',
          placeHolder: 'https://gitlab.example.com',
          ignoreFocusOut: true,
          validateInput: validateInstanceUrl,
        }));
      if (!instanceUrl) return;
      const account = await createPatFlow().authenticate(instanceUrl.replace(/\/$/, ''));
      if (!account) return;
      await accountService.addAccount(account);
      await vscode.window.showInformationMessage(
        `Review Tools for GitLab: signed in to ${account.instanceUrl}.`,
      );
    },
    [USER_COMMANDS.REMOVE_ACCOUNT]: removeAccount,
    [USER_COMMANDS.VALIDATE_ACCOUNTS]: validateAccounts,
    [USER_COMMANDS.SELECT_WORKSPACE_ACCOUNT]:
      createSelectWorkspaceAccountCommand(workspaceAccounts),
    [USER_COMMANDS.DESELECT_WORKSPACE_ACCOUNT]:
      createDeselectWorkspaceAccountCommand(workspaceAccounts),
    [COMMON_USER_COMMANDS.SHOW_LOGS]: createShowOutputCommand(outputChannel),
    [USER_COMMANDS.SHOW_MERGE_REQUESTS_ASSIGNED_TO_ME]: runWithValidProject(showMergeRequests),
    [USER_COMMANDS.OPEN_CURRENT_MERGE_REQUEST]: runWithValidProject(openCurrentMergeRequest),
    [USER_COMMANDS.MERGE_REQUEST_SEARCH]: runWithValidProject(showMergeRequestSearchInput),
    [PROGRAMMATIC_COMMANDS.SHOW_RICH_CONTENT]: issuableController.open.bind(issuableController),
    [USER_COMMANDS.SIDEBAR_VIEW_AS_LIST]: () => setSidebarViewState(SidebarViewState.ListView),
    [USER_COMMANDS.SIDEBAR_VIEW_AS_TREE]: () => setSidebarViewState(SidebarViewState.TreeView),
    [USER_COMMANDS.REFRESH_SIDEBAR]: async () => {
      await accountService.reloadCache();
      await getProjectRepository().reload();
      provider.refresh();
    },
    [USER_COMMANDS.RESOLVE_THREAD]: toggleResolved,
    [USER_COMMANDS.UNRESOLVE_THREAD]: toggleResolved,
    [USER_COMMANDS.DELETE_COMMENT]: deleteComment,
    [USER_COMMANDS.START_EDITING_COMMENT]: editComment,
    [USER_COMMANDS.CANCEL_EDITING_COMMENT]: cancelEdit,
    [USER_COMMANDS.SUBMIT_COMMENT_EDIT]: submitEdit,
    [USER_COMMANDS.CREATE_COMMENT]: createComment,
    [USER_COMMANDS.CANCEL_FAILED_COMMENT]: cancelFailedComment,
    [USER_COMMANDS.RETRY_FAILED_COMMENT]: retryFailedComment,
    [USER_COMMANDS.CHECKOUT_MR_BRANCH]: checkoutMrBranch,
    [USER_COMMANDS.OPEN_IN_GITLAB]: openInGitLab,
    [USER_COMMANDS.COPY_LINK_TO_CLIPBOARD]: copyLinkToClipboard,
    [USER_COMMANDS.OPEN_COMMIT_IN_GITLAB]: openCommitInGitLab,
    [USER_COMMANDS.OPEN_MR_FILE]: navigation.openFile.bind(navigation),
    [USER_COMMANDS.SELECT_PROJECT_FOR_REPOSITORY]: selectProjectForRepository,
    [USER_COMMANDS.SELECT_PROJECT]: selectProjectCommand,
    [USER_COMMANDS.ASSIGN_PROJECT]: assignProject,
    [USER_COMMANDS.CLEAR_SELECTED_PROJECT]: clearSelectedProjects,
  };
  Object.entries(commands).forEach(([name, command]) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(name, wrapCommandWithCatch(command)),
    );
  });
  await setSidebarViewState(SidebarViewState.TreeView);
  await gitExtensionWrapper.init();
  await projects.init();
  await validateAccounts(true).catch(handleError);
}
