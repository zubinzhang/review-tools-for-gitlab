const assert = require('assert');
const sinon = require('sinon');
const vscode = require('vscode');
const { graphql, HttpResponse } = require('msw');

const { IssuableDataProvider } = require('../../src/desktop/tree_view/issuable_data_provider');
const { MrItemModel } = require('../../src/desktop/tree_view/items/mr_item_model');
const { submitEdit, createComment } = require('../../src/desktop/commands/mr_discussion_commands');
const { toReviewUri, fromReviewUri } = require('../../src/desktop/review/review_uri');
const { CommentingRangeProvider } = require('../../src/desktop/review/commenting_range_provider');
const {
  getSidebarViewState,
  setSidebarViewState,
  SidebarViewState,
} = require('../../src/desktop/tree_view/sidebar_view_state');
const { getProjectRepository } = require('../../src/desktop/gitlab/gitlab_project_repository');
const { ReviewFileSystem } = require('../../src/desktop/review/review_file_system');
const { getExtensionStateSingleton } = require('../../src/desktop/extension_state');
const openMergeRequestResponse = require('./fixtures/rest/open_mr.json');
const versionsResponse = require('./fixtures/rest/versions.json');
const versionResponse = require('./fixtures/rest/mr_version.json');
const diffNote = require('./fixtures/rest/diff_note.json');
const {
  projectWithMrDiscussions,
  noteOnDiff,
  discussionOnDiff,
} = require('./fixtures/graphql/discussions');
const mrPermissionsResponse = require('./fixtures/graphql/mr_permissions.json');
const {
  getServer,
  createJsonEndpoint,
  createQueryTextEndpoint,
  createQueryJsonEndpoint,
} = require('./test_infrastructure/mock_server');
const { getRepositoryRoot } = require('./test_infrastructure/helpers');

describe('MR Review', () => {
  let server;
  let dataProvider;
  let mrItemModel;

  before(async () => {
    server = getServer([
      createJsonEndpoint('/projects/278964/merge_requests/33824/versions', versionsResponse),
      createJsonEndpoint('/projects/278964/merge_requests/33824/notes/469379582', diffNote), // TODO remove
      createJsonEndpoint(
        '/projects/278964/merge_requests/33824/versions/127919672',
        versionResponse,
      ),
      createQueryTextEndpoint(`/projects/278964/repository/files/src%2Ftest.js/raw`, {
        '?ref=1f0fa02de1f6b913d674a8be10899fb8540237a9': 'Old Version',
        '?ref=b6d6f6fd17b52b8cf4e961218c572805e9aa7463': 'New Version',
      }),
      graphql.query('GetMrDiscussions', ({ variables }) => {
        if (variables.namespaceWithPath === 'gitlab-org/gitlab' && variables.iid === '33824')
          return HttpResponse.json({ data: projectWithMrDiscussions });
        return HttpResponse.json({ data: { project: null } });
      }),
      graphql.query('GetMrPermissions', ({ variables }) => {
        if (variables.namespaceWithPath === 'gitlab-org/gitlab' && variables.iid === '33824')
          return HttpResponse.json({ data: mrPermissionsResponse });
        return HttpResponse.json({ data: { project: null } });
      }),
      graphql.mutation('CreateDiffNote', ({ variables }) => {
        if (
          variables.issuableId === `gid://gitlab/MergeRequest/${openMergeRequestResponse.id}` &&
          variables.body === 'new comment'
        )
          return HttpResponse.json({
            data: { createDiffNote: { note: { discussion: discussionOnDiff } } },
          });
        return new HttpResponse(null, { status: 500 });
      }),
    ]);
  });

  beforeEach(async () => {
    await setSidebarViewState(SidebarViewState.ListView);
    server.resetHandlers();
    dataProvider = new IssuableDataProvider(getExtensionStateSingleton());
    mrItemModel = new MrItemModel(
      openMergeRequestResponse,
      getProjectRepository().getProjectOrFail(getRepositoryRoot()),
    );
  });

  after(async () => {
    server.close();
  });

  const getTreeItem = model => dataProvider.getTreeItem(model);

  it('groups MR files by directory in tree view', async () => {
    await setSidebarViewState(SidebarViewState.TreeView);
    assert.strictEqual(getSidebarViewState(), SidebarViewState.TreeView);
    const items = await dataProvider.getChildren(mrItemModel);
    const folder = items.find(model => getTreeItem(model).label === 'src');
    assert.ok(folder, 'Expected src directory in MR tree');
    const children = await dataProvider.getChildren(folder);
    assert.ok(children.some(model => getTreeItem(model).resourceUri?.path === '/src/test.js'));
  });

  it('shows MR item with changed files', async () => {
    const mrItem = getTreeItem(mrItemModel);
    assert.strictEqual(mrItem.label, '!33824 · Web IDE - remove unused actions (mappings)');

    const mrContent = await dataProvider.getChildren(mrItemModel);
    assert.strictEqual(getTreeItem(mrContent[0]).label, 'Overview');

    assert.strictEqual(getTreeItem(mrContent[1]).label, 'Commits');
    const mrFiles = mrContent.slice(2);
    assert.deepStrictEqual(
      mrFiles.map(f => getTreeItem(f).resourceUri.path),
      [
        '/.deleted.yml',
        '/README1.md',
        '/new_file.ts',
        '/src/test.js',
        '/src/assets/insert-multi-file-snippet.gif',
        '/Screenshot.png',
      ],
    );

    assert.deepStrictEqual(
      mrFiles.map(f => getTreeItem(f).description),
      ['', '', '', 'src', 'src/assets', ''],
    );
  });

  it('browses MR commits and opens an exact first-parent diff inside VS Code', async () => {
    const commit = {
      id: versionResponse.head_commit_sha,
      parent_ids: ['d'.repeat(40)],
      title: 'Change a helper',
      message: 'Change a helper\n\nCommit details',
      author_name: 'Reviewer',
      committed_date: '2026-11-09T04:00:00Z',
    };
    server.use(
      createQueryJsonEndpoint('/projects/278964/merge_requests/33824/commits', {
        '?page=1&per_page=100': [commit],
      }),
      createQueryJsonEndpoint(`/projects/278964/repository/commits/${commit.id}/diff`, {
        '?page=1&per_page=100': [
          {
            old_path: 'src/test.js',
            new_path: 'src/test.js',
            new_file: false,
            deleted_file: false,
            renamed_file: false,
            diff: '@@ -1 +1 @@\n-parent\n+head\n',
          },
        ],
      }),
      createQueryJsonEndpoint('/projects/278964/repository/files/src%2Ftest.js', {
        [`?ref=${commit.id}`]: { size: 11 },
        [`?ref=${commit.parent_ids[0]}`]: { size: 13 },
      }),
      createQueryTextEndpoint('/projects/278964/repository/files/src%2Ftest.js/raw', {
        [`?ref=${commit.id}`]: 'Commit head',
        [`?ref=${commit.parent_ids[0]}`]: 'Commit parent',
      }),
    );
    const content = await dataProvider.getChildren(mrItemModel);
    const commits = content.find(child => getTreeItem(child).label === 'Commits');
    const [commitItem] = await dataProvider.getChildren(commits);
    assert.strictEqual(getTreeItem(commitItem).label, commit.title);
    assert.strictEqual(dataProvider.getParent(commitItem), commits);
    const [link, changed] = await dataProvider.getChildren(commitItem);
    assert.strictEqual(link.command.command, 'gitlab-review.openCommitInGitLab');
    assert.strictEqual(dataProvider.getParent(changed), commitItem);
    const [original, modified] = changed.command.arguments;
    assert.strictEqual(fromReviewUri(original).commit, commit.parent_ids[0]);
    assert.strictEqual(fromReviewUri(modified).commit, commit.id);
    assert.strictEqual(fromReviewUri(modified).comparison, 'commit');
    await vscode.commands.executeCommand(changed.command.command, ...changed.command.arguments);
    try {
      const { input } = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(input instanceof vscode.TabInputTextDiff);
      assert.strictEqual(input.original.toString(), original.toString());
      assert.strictEqual(input.modified.toString(), modified.toString());
      assert.strictEqual(
        (await vscode.workspace.openTextDocument(original)).getText(),
        'Commit parent',
      );
      const document = await vscode.workspace.openTextDocument(modified);
      assert.strictEqual(document.getText(), 'Commit head');
      assert.deepStrictEqual(
        new CommentingRangeProvider(
          openMergeRequestResponse,
          versionResponse,
        ).provideCommentingRanges(document),
        [],
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  describe('discussions', () => {
    const sandbox = sinon.createSandbox();
    let thread;
    let commentController;

    beforeEach(() => {
      thread = {};
      /* We fake createCommentController implementation to check
      that when we initialize an MR review, we create a correct comment controller
      we save the created thread for later use in assertions */
      commentController = {
        createCommentThread: (uri, range, comments) => {
          thread = { uri, range, comments };
          return thread;
        },
        dispose: () => {},
      };
      sandbox.stub(vscode.comments, 'createCommentController').returns(commentController);
    });
    afterEach(() => {
      sandbox.restore();
    });

    it('loads MR discussions', async () => {
      const mrItem = getTreeItem(mrItemModel);
      assert.strictEqual(mrItem.label, '!33824 · Web IDE - remove unused actions (mappings)');

      await dataProvider.getChildren(mrItemModel);

      const { uri, range, comments } = thread;
      assert.strictEqual(uri.path, `/${noteOnDiff.position.oldPath}`);
      assert.strictEqual(range.start.line, noteOnDiff.position.oldLine - 1);
      assert.strictEqual(comments[0].body.value, noteOnDiff.body);
    });

    it('editing comment fails if the comment body has changed on the GitLab instance', async () => {
      await dataProvider.getChildren(mrItemModel);
      const [firstComment] = thread.comments;
      firstComment.gqlNote.body =
        'this body simulates that our version of the note body is out of sync with the GitLab instance';
      firstComment.body = 'user wants to change the body to this';

      await assert.rejects(
        submitEdit(firstComment),
        /This comment changed after you last viewed it, and can't be edited/,
      );
    });
  });

  describe('clicking on a changed file', () => {
    let mrFiles;

    const getItem = filePath => mrFiles.filter(f => f.resourceUri.path === filePath).pop();

    const getDiffArgs = item => {
      assert.strictEqual(item.command.command, 'vscode.diff');
      return item.command.arguments;
    };

    before(async () => {
      assert.strictEqual(
        getTreeItem(mrItemModel).label,
        '!33824 · Web IDE - remove unused actions (mappings)',
      );

      const mrContent = await dataProvider.getChildren(mrItemModel);
      assert.strictEqual(mrContent[0].label, 'Overview');

      mrFiles = mrContent.slice(2);
    });

    it('should show the correct diff title', () => {
      const item = getItem('/README1.md');
      const [, , diffTitle] = getDiffArgs(item);
      assert.strictEqual(diffTitle, 'README1.md (!33824)');
    });

    describe('Api content provider', () => {
      let fileSystem;

      before(() => {
        fileSystem = new ReviewFileSystem();
      });

      it('should fetch base content for a diff URI', async () => {
        const item = getItem('/src/test.js');
        const [baseUri] = getDiffArgs(item);
        const content = await fileSystem.readFile(baseUri);
        assert.strictEqual(content.toString(), 'Old Version');
      });

      it('should fetch head content for a diff URI', async () => {
        const item = getItem('/src/test.js');
        const [, headUri] = getDiffArgs(item);
        const content = await fileSystem.readFile(headUri);
        assert.strictEqual(content.toString(), 'New Version');
      });

      it('should show empty file when asked to fetch base content for added file', async () => {
        const item = getItem('/new_file.ts');
        const [baseUri] = getDiffArgs(item);
        const content = await fileSystem.readFile(baseUri);
        assert.strictEqual(content.length, 0);
      });

      it('should show empty file when asked to fetch head content for deleted file', async () => {
        const item = getItem('/.deleted.yml');
        const [, headUri] = getDiffArgs(item);
        const content = await fileSystem.readFile(headUri);
        assert.strictEqual(content.length, 0);
      });
    });

    describe('Creating a new diff comment thread', () => {
      it('should create a new comment', async () => {
        // This URI represents old version of `src/test.js` file (versionResponse fixture) in the test MR (openMergeRequestResponse fixture)
        const uri = toReviewUri({
          path: `src/test.js`,
          exists: true,
          changeType: 'modified',
          side: 'base',
          commit: versionResponse.base_commit_sha, // base sha === old version of the file
          mrId: openMergeRequestResponse.id,
          projectId: openMergeRequestResponse.project_id,
          repositoryRoot: getRepositoryRoot(),
        });

        const thread = {
          uri,
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
          comments: [],
        };

        await createComment({ text: 'new comment', thread });

        assert.strictEqual(thread.comments.length, 1); // comment has been added
      });
    });
  });
});
