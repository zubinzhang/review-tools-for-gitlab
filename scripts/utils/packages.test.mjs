import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDesktopPackageJson } from './packages.mjs';

test('builds an independently identified GitLab Review extension', () => {
  const manifest = createDesktopPackageJson();
  assert.equal(manifest.name, 'review-tools-for-gitlab');
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'zubinzhang.review-tools-for-gitlab');
  assert.equal(manifest.displayName, 'Review Tools for GitLab');
  assert.equal(manifest.icon, 'assets/review-tools.png');
  assert.equal(manifest.repository.url, 'https://github.com/zubinzhang/review-tools-for-gitlab');
  assert.equal(manifest.bugs.url, 'https://github.com/zubinzhang/review-tools-for-gitlab/issues');
  assert.equal(manifest.bugs.email, undefined);
  assert.equal(manifest.publisher, 'zubinzhang');
  assert.equal(manifest.main, 'extension');
  assert.deepEqual(manifest.extensionDependencies, ['vscode.git']);
});

test('contributes only the merge request review view', () => {
  const { contributes } = createDesktopPackageJson();
  assert.deepEqual(Object.keys(contributes.views), ['gitlab-review']);
  assert.deepEqual(
    contributes.views['gitlab-review'].map(view => view.id),
    ['gitlabReview.mergeRequests'],
  );
  assert.deepEqual(
    contributes.viewsContainers.activitybar.map(view => view.id),
    ['gitlab-review'],
  );
});

test('retains every review action under a private command namespace', () => {
  const manifest = createDesktopPackageJson();
  const commands = new Set(manifest.contributes.commands.map(command => command.command));
  for (const action of [
    'authenticate',
    'mergeRequestSearch',
    'refreshSidebar',
    'checkoutMrBranch',
    'openMrFile',
    'createComment',
    'startEditingComment',
    'submitCommentEdit',
    'deleteComment',
    'cancelEditingComment',
    'resolveThread',
    'unresolveThread',
    'retryFailedComment',
    'cancelFailedComment',
    'selectProject',
    'assignProject',
    'clearSelectedProject',
    'prepareCodeNavigation',
  ]) {
    assert.ok(commands.has(`gitlab-review.${action}`), action);
  }
  assert.ok([...commands].every(command => command.startsWith('gitlab-review.')));
  assert.ok(
    [...commands].every(command => !/pipeline|snippet|duo|chat|security|issue|mcp/i.test(command)),
  );
  assert.ok(
    manifest.contributes.commands.every(command => command.category === 'Review Tools for GitLab'),
  );
});

test('contributes MR-only defaults without AI or telemetry settings', () => {
  const manifest = createDesktopPackageJson();
  const properties = Object.assign(
    {},
    ...manifest.contributes.configuration.map(group => group.properties),
  );
  assert.ok(properties['gitlab.customQueries'].default.length > 0);
  assert.ok(
    properties['gitlab.customQueries'].default.every(query => query.type === 'merge_requests'),
  );
  assert.ok(Object.keys(properties).every(name => !/duo|pipeline|security|telemetry/i.test(name)));
  assert.equal(manifest.contributes.walkthroughs, undefined);
});

test('has no orphaned menu actions or references to upstream views and commands', () => {
  const { contributes } = createDesktopPackageJson();
  const commands = new Set(contributes.commands.map(command => command.command));
  for (const entries of Object.values(contributes.menus)) {
    for (const entry of entries) {
      assert.ok(commands.has(entry.command), JSON.stringify(entry));
    }
  }
  const serialized = JSON.stringify(contributes);
  assert.ok(!serialized.includes('command:gl.'));
  assert.ok(!serialized.includes('currentBranchInfo'));
  assert.ok(!serialized.includes('issuesAndMrs'));
  assert.ok(!serialized.includes('gitlab-workflow'));
  assert.ok(!serialized.includes('$(gitlab-logo)'));
  assert.deepEqual(Object.keys(contributes.icons), ['review-tools']);
  assert.equal(contributes.viewsContainers.activitybar[0].title, 'Review Tools for GitLab');
});
