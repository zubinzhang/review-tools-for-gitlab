const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const vscode = require('vscode');
const sinon = require('sinon');
const { ProjectItemModel } = require('../../src/desktop/tree_view/items/project_item_model');
const serviceModule = require('../../src/desktop/gitlab/get_gitlab_service');
const { ReviewNavigation } = require('../../src/desktop/review/review_navigation');
const { ReviewWorkspace } = require('../../src/desktop/review/review_workspace');
const { ReviewWorktreeManager } = require('../../src/desktop/review/review_worktree');
const { ReviewTreeController } = require('../../src/desktop/review/review_tree_controller');
const { InMemoryMemento } = require('../integration/test_infrastructure/in_memory_memento');

const execute = promisify(execFile);

describe('Automatic review preparation through a real tree view', function automaticTreePreparation() {
  this.timeout(60000);

  it('prepares the selected MR on expansion and restores that MR after recreating the view', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-tree-integration-'));
    const repository = path.join(directory, 'repository');
    await fs.mkdir(repository);
    const git = async (...args) =>
      (await execute('git', ['-C', repository, ...args])).stdout.trim();
    await git('init', '--initial-branch=main');
    await git('config', 'user.name', 'Review Test');
    await git('config', 'user.email', 'review@example.invalid');
    await fs.writeFile(path.join(repository, 'added.ts'), 'export const added = 42;\n');
    await git('add', '.');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'MR head', '--no-gpg-sign');
    const commit = await git('rev-parse', 'HEAD');
    const storage = path.join(directory, 'cache');
    const manager = new ReviewWorktreeManager(storage, 'git');
    const workspace = new ReviewWorkspace(storage);
    const navigation = new ReviewNavigation(manager, undefined, undefined, workspace);
    const state = new InMemoryMemento();
    const project = {
      account: { id: 'test', instanceUrl: 'https://example.invalid' },
      project: { restId: 10, name: 'Project' },
      pointer: {
        repository: {
          rootFsPath: repository,
          rawRepository: { rootUri: vscode.Uri.file(repository) },
        },
        remote: { name: 'origin' },
        urlEntry: { url: 'git@example.invalid:test/repo.git' },
      },
    };
    const selectedRequest = {
      repositoryRoot: repository,
      projectId: 10,
      mrId: 101,
      mrIid: 8,
      remoteName: 'origin',
      commit,
    };
    const target = manager.getPath(selectedRequest);
    const disposables = [];
    const sandbox = sinon.createSandbox();
    const mrs = [100, 101].map(id => ({
      id,
      iid: id - 93,
      project_id: 10,
      title: `MR ${id}`,
      state: 'opened',
      author: { avatar_url: null },
      source_project_id: 10,
      target_project_id: 10,
      references: { full: `test/repo!${id - 93}` },
    }));
    sandbox.stub(serviceModule, 'getGitLabService').returns({
      getIssuables: async () => mrs,
      getMrDiff: async () => ({ head_commit_sha: commit, base_commit_sha: commit, diffs: [] }),
      getDiscussions: async () => [],
      canUserCommentOnMr: async () => false,
    });
    const makeView = async () => {
      const root = new ProjectItemModel(project, [{ name: 'MRs', type: 'merge_requests' }], true);
      const parents = new WeakMap();
      const provider = {
        getChildren: async element => {
          if (!element) return [root];
          const children = await element.getChildren();
          children.forEach(child => parents.set(child, element));
          return children;
        },
        getParent: element => parents.get(element) ?? null,
        getTreeItem: element =>
          element instanceof vscode.TreeItem ? element : element.getTreeItem(),
        getElementPath: item => [
          root.getTreeItem().id,
          parents.get(item).getTreeItem().id,
          item.getTreeItem().id,
        ],
      };
      const [query] = await provider.getChildren(root);
      const items = await provider.getChildren(query);
      const tree = vscode.window.createTreeView('gitlabReview.testPreparation', {
        treeDataProvider: provider,
      });
      const controller = new ReviewTreeController(tree, provider, navigation, workspace, state);
      const listener = controller.listen();
      disposables.push(listener, tree, root);
      return { tree, controller, items, root, listener };
    };
    try {
      const initial = await makeView();
      await initial.tree.reveal(initial.items[1], { select: true, expand: true, focus: false });
      const deadline = Date.now() + 20000;
      const ready = async () => {
        if (workspace.isIncluded(target)) return;
        if (Date.now() >= deadline)
          throw new Error('Selecting the MR did not automatically prepare its snapshot');
        await new Promise(resolve => {
          setTimeout(resolve, 50);
        });
        await ready();
      };
      await ready();
      assert.strictEqual(
        await fs.readFile(path.join(target, 'added.ts'), 'utf8'),
        'export const added = 42;\n',
      );
      assert.strictEqual(initial.tree.selection[0].mr.id, 101);
      initial.listener.dispose();
      initial.tree.dispose();
      const restored = await makeView();
      await restored.tree.reveal(restored.root, { expand: true, focus: false });
      await restored.controller.restore();
      assert.strictEqual(restored.tree.selection[0].mr.id, 101);
      assert.strictEqual(
        (await git('worktree', 'list', '--porcelain')).match(/^worktree /gm).length,
        2,
      );
      assert.strictEqual(await git('branch', '--show-current'), 'main');
    } finally {
      disposables.forEach(disposable => disposable.dispose());
      sandbox.restore();
      workspace.setSelectedReview(undefined);
      await workspace.removeInactive();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
