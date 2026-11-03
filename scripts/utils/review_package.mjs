const reviewActions = new Set([
  'authenticate',
  'removeAccount',
  'validateAccounts',
  'selectWorkspaceAccount',
  'deselectWorkspaceAccount',
  'showOutput',
  'showMergeRequestsAssignedToMe',
  'openCurrentMergeRequest',
  'mergeRequestSearch',
  'sidebarViewAsList',
  'sidebarViewAsTree',
  'refreshSidebar',
  'resolveThread',
  'unresolveThread',
  'deleteComment',
  'startEditingComment',
  'cancelEditingComment',
  'cancelFailedComment',
  'retryFailedComment',
  'submitCommentEdit',
  'createComment',
  'checkoutMrBranch',
  'openInGitLab',
  'openCommitInGitLab',
  'copyLinkToClipboard',
  'openMrFile',
  'selectProjectForRepository',
  'selectProject',
  'assignProject',
  'clearSelectedProject',
]);

const reviewSettings = new Set([
  'gitlab.debug',
  'gitlab.ca',
  'gitlab.cert',
  'gitlab.certKey',
  'gitlab.ignoreCertificateErrors',
  'gitlab.showClosedMergeRequests',
  'gitlab.customQueries',
]);

export function createReviewPackage(manifest) {
  const isReviewCommand = command => reviewActions.has(command?.replace(/^gl\./, ''));
  const original = manifest.contributes;
  const commands = original.commands
    .filter(command => isReviewCommand(command.command))
    .map(command => ({ ...command, category: 'Review Tools for GitLab' }));
  commands.push({
    command: 'gitlab-review.prepareCodeNavigation',
    title: 'Prepare MR Code Navigation',
    category: 'Review Tools for GitLab',
    icon: '$(go-to-file)',
  });
  const menus = Object.fromEntries(
    Object.entries(original.menus).map(([name, entries]) => [
      name,
      entries.filter(entry => isReviewCommand(entry.command)),
    ]),
  );
  const properties = Object.fromEntries(
    original.configuration.flatMap(group =>
      Object.entries(group.properties).filter(([name]) => reviewSettings.has(name)),
    ),
  );
  for (const menu of ['editor/title', 'editor/context']) {
    menus[menu] ??= [];
    menus[menu].push({
      command: 'gitlab-review.prepareCodeNavigation',
      when: 'resourceScheme == gitlab-review-diff',
      group: 'navigation@10',
    });
  }
  const openFile = commands.find(command => command.command === 'gl.openMrFile');
  if (openFile) openFile.title = 'Open MR File in Review Worktree';
  properties['gitlab.customQueries'].default = properties['gitlab.customQueries'].default.filter(
    query => query.type === 'merge_requests',
  );
  properties['gitlab.customQueries'].items.properties.type.enum = ['merge_requests'];

  const contributes = {
    commands,
    menus,
    viewsContainers: {
      activitybar: [
        { id: 'gitlab-review', title: 'Review Tools for GitLab', icon: '$(review-tools)' },
      ],
    },
    views: {
      'gitlab-review': [{ id: 'gitlabReview.mergeRequests', name: 'Merge Requests' }],
    },
    viewsWelcome: original.viewsWelcome.filter(entry => entry.view === 'issuesAndMrs'),
    configuration: [{ title: 'Review Tools for GitLab', properties }],
    keybindings: original.keybindings.filter(entry => isReviewCommand(entry.command)),
    icons: {
      'review-tools': {
        description: 'Review Tools',
        default: { fontPath: './assets/gitlab_icons.woff', fontCharacter: '\\eA01' },
      },
    },
  };
  const rewritten = JSON.stringify(contributes)
    .replaceAll('gl.', 'gitlab-review.')
    .replaceAll('gitlab:', 'gitlabReview:')
    .replaceAll('issuesAndMrs', 'gitlabReview.mergeRequests')
    .replaceAll('currentBranchInfo', 'gitlabReview.mergeRequests')
    .replaceAll('gitlab-mr-', 'gitlab-review-mr-')
    .replaceAll('GitLab extension', 'Review Tools for GitLab');

  const { dependencies, devDependencies, scripts, ...metadata } = manifest;
  return {
    ...metadata,
    icon: 'assets/review-tools.png',
    extensionDependencies: ['vscode.git'],
    activationEvents: ['onStartupFinished'],
    contributes: JSON.parse(rewritten),
  };
}
