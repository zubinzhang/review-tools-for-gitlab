import * as vscode from 'vscode';
import { mr, projectInRepository } from '../../test_utils/entities';
import {
  discussionOnDiff,
  noteOnDiffBody,
  multipleNotes,
} from '../../../../test/integration/fixtures/graphql/discussions';
import * as mrVersion from '../../../../test/integration/fixtures/rest/mr_version.json';
import { CommentingRangeProvider } from '../../review/commenting_range_provider';
import { fromReviewUri } from '../../review/review_uri';
import { DELETED, CHANGE_TYPE_QUERY_KEY, HAS_COMMENTS_QUERY_KEY } from '../../constants';
import { setSidebarViewState, SidebarViewState } from '../sidebar_view_state';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { GitLabService } from '../../gitlab/gitlab_service';
import { viewedFilesStore } from '../../review/viewed_files_store';
import { createFakePartial } from '../../../common/test_utils/create_fake_partial';
import { InMemoryMemento } from '../../../../test/integration/test_infrastructure/in_memory_memento';
import { ChangedFolderItem } from './changed_folder_item';
import { ChangedFileItem } from './changed_file_item';
import { MrItemModel } from './mr_item_model';
import { MrCommitsItem } from './mr_commits_item';
import { ReviewCommit } from './mr_commit_item';

jest.mock('../../gitlab/get_gitlab_service');

const createCommentControllerMock = vscode.comments
  .createCommentController as jest.Mock<vscode.CommentController>;

describe('MrItemModel', () => {
  let item: MrItemModel;
  let commentThread: vscode.CommentThread;
  let canUserCommentOnMr = false;
  let commentController: vscode.CommentController;
  let gitLabService: GitLabService;

  const createCommentThreadMock = jest.fn();

  beforeEach(() => {
    viewedFilesStore.init(
      createFakePartial<vscode.ExtensionContext>({ globalState: new InMemoryMemento() }),
    );
    gitLabService = createFakePartial<GitLabService>({
      getDiscussions: jest.fn().mockResolvedValue([discussionOnDiff, multipleNotes]),
      getMrDiff: jest.fn().mockResolvedValue({ diffs: [] }),
      canUserCommentOnMr: jest.fn(async () => canUserCommentOnMr),
    });
    jest.mocked(getGitLabService).mockReturnValue(gitLabService);
    item = new MrItemModel(mr, projectInRepository);
    commentThread = {} as vscode.CommentThread;

    commentController = createFakePartial<vscode.CommentController>({
      createCommentThread: createCommentThreadMock.mockReturnValue(commentThread),
      dispose: jest.fn(),
    });
    createCommentControllerMock.mockReturnValue(commentController);
  });

  afterEach(() => {
    createCommentControllerMock.mockReset();
    createCommentThreadMock.mockReset();
  });

  describe('MR item description', () => {
    it('should show Closed status', () => {
      item = new MrItemModel({ ...mr, state: 'closed' }, projectInRepository);
      expect(item.getTreeItem().description).toBe('Closed');
    });

    it('should show Merged status', () => {
      item = new MrItemModel({ ...mr, state: 'merged' }, projectInRepository);
      expect(item.getTreeItem().description).toBe('Merged');
    });

    it('should hide other status', () => {
      expect(item.getTreeItem().description).toBeFalsy();
    });
  });

  describe('MR item context', () => {
    it('should return return correct context when MR comes from the same project', () => {
      item = new MrItemModel(
        { ...mr, source_project_id: 1234, target_project_id: 1234 },
        projectInRepository,
      );
      expect(item.getTreeItem().contextValue).toBe('web-openable;mr-item-from-same-project');
    });

    it('should return return correct context when MR comes from a fork', () => {
      item = new MrItemModel(
        { ...mr, source_project_id: 5678, target_project_id: 1234 },
        projectInRepository,
      );
      expect(item.getTreeItem().contextValue).toBe('web-openable;mr-item-from-fork');
    });
  });

  it('should add comment thread to VS Code', async () => {
    await item.getChildren();
    expect(createCommentControllerMock).toHaveBeenCalledWith(
      'gitlab-review-mr-gitlab-org/gitlab!2000',
      'Issuable Title',
    );
    const [, range] = createCommentThreadMock.mock.calls[0];
    expect(range.start.line).toBe(47);
    expect(commentThread.comments.length).toBe(1);
    const firstComment = commentThread.comments[0];
    expect(firstComment.author.name).toBe('Tomas Vik');
    expect(firstComment.mode).toBe(vscode.CommentMode.Preview);
    expect(firstComment.body).toEqual(new vscode.MarkdownString(noteOnDiffBody));
  });

  it('should associate the thread with the correct URI', async () => {
    const discussionPosition = discussionOnDiff.notes.nodes[0].position;

    // used to determine the changeType in the comment URI
    gitLabService.getMrDiff = jest.fn().mockResolvedValue({
      diffs: [
        {
          old_path: discussionPosition.oldPath,
          new_path: '',
          a_mode: '100644',
          b_mode: '0',
          new_file: false,
          renamed_file: false,
          deleted_file: true,
          diff: '',
        },
      ],
    });

    await item.getChildren();

    const [uri] = createCommentThreadMock.mock.calls[0];
    const { mrId, projectId, repositoryRoot, commit, path, changeType, side } = fromReviewUri(uri);
    expect(side).toBe(discussionPosition.oldLine !== null ? 'base' : 'head');
    expect(mrId).toBe(mr.id);
    expect(projectId).toBe(mr.project_id);
    expect(repositoryRoot).toBe(projectInRepository.pointer.repository.rootFsPath);

    expect(commit).toBe(discussionPosition.diffRefs.baseSha);
    expect(path).toBe(discussionPosition.oldPath);
    expect(changeType).toBe(DELETED);
  });

  it('should return changed file items as children', async () => {
    gitLabService.getMrDiff = jest.fn().mockResolvedValue(mrVersion);
    await setSidebarViewState(SidebarViewState.ListView);
    const [, commits, changedItem] = await item.getChildren();
    expect(commits).toBeInstanceOf(MrCommitsItem);
    if (!(changedItem instanceof vscode.TreeItem)) throw new Error('Expected changed file');
    expect(changedItem.resourceUri?.path).toBe('.deleted.yml');
    expect(changedItem.resourceUri?.query).toMatch(`${CHANGE_TYPE_QUERY_KEY}=deleted`);
    expect(changedItem.resourceUri?.query).toMatch(`${HAS_COMMENTS_QUERY_KEY}=false`);
  });

  it('should return changed file items in tree view', async () => {
    gitLabService.getMrDiff = jest.fn().mockResolvedValue(mrVersion);
    await setSidebarViewState(SidebarViewState.TreeView);
    const [, , folderItem, fileItem] = await item.getChildren();
    if (!(folderItem instanceof vscode.TreeItem) || !(fileItem instanceof vscode.TreeItem))
      throw new Error('Expected file tree items');

    expect(folderItem).toBeInstanceOf(ChangedFolderItem);
    expect(folderItem.label).toBe('src');

    expect(fileItem).toBeInstanceOf(ChangedFileItem);
    expect(fileItem.resourceUri?.path).toBe('.deleted.yml');
    expect(fileItem.resourceUri?.query).toMatch(`${CHANGE_TYPE_QUERY_KEY}=${DELETED}`);
    expect(fileItem.resourceUri?.query).toMatch(`${HAS_COMMENTS_QUERY_KEY}=false`);
  });

  it('should handle error when getting child items', async () => {
    gitLabService.getMrDiff = jest.fn().mockRejectedValue(new Error());
    const children = await item.getChildren();

    // returns the overview item instead of throwing
    expect(children.length).toBe(2);
    expect(children[1]).toBeInstanceOf(MrCommitsItem);
  });

  describe('commit filtering', () => {
    const commit: ReviewCommit = {
      id: 'a'.repeat(40),
      parent_ids: ['b'.repeat(40)],
      title: 'Only a helper',
      message: 'Only a helper',
      author_name: 'Reviewer',
      committed_date: '2026-11-09T04:00:00Z',
    };
    const changedFile = {
      old_path: 'one/helper.ts',
      new_path: 'one/helper.ts',
      diff: '@@ -1 +1 @@\n-old\n+new',
      new_file: false,
      deleted_file: false,
      renamed_file: false,
    };

    beforeEach(async () => {
      await setSidebarViewState(SidebarViewState.ListView);
      gitLabService.getMrDiff = jest.fn().mockResolvedValue(mrVersion);
      gitLabService.fetchFromApi = jest.fn().mockResolvedValue([changedFile]);
    });

    it('replaces the MR file list with a single commit and restores all files and viewed state', async () => {
      const all = await item.getChildren();
      expect(all.slice(2).every(child => child instanceof ChangedFileItem)).toBe(true);
      const firstFile = all[2] as ChangedFileItem;
      const { mrKey, fileId, contentHash } = firstFile.viewedState;
      await viewedFilesStore.setViewed(mrKey, fileId, contentHash);
      item.selectCommit(commit);
      const filtered = await item.getChildren();
      const files = filtered.filter(
        child => child instanceof vscode.TreeItem && child.command?.command === 'vscode.diff',
      ) as vscode.TreeItem[];
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe('helper.ts');
      expect(fromReviewUri(files[0].command!.arguments![1])).toMatchObject({
        commit: commit.id,
        comparison: 'commit',
      });
      expect(files[0].checkboxState).toBeUndefined();
      item.selectCommit(undefined);
      const restored = await item.getChildren();
      expect(restored.slice(2).every(child => child instanceof ChangedFileItem)).toBe(true);
      expect(restored.slice(2)).toHaveLength(all.length - 2);
      expect((restored[2] as ChangedFileItem).checkboxState).toBe(
        vscode.TreeItemCheckboxState.Checked,
      );
      expect(createCommentControllerMock).toHaveBeenCalledTimes(1);
      expect(commentController.dispose).not.toHaveBeenCalled();
    });

    it('uses the directory tree for selected commits', async () => {
      await setSidebarViewState(SidebarViewState.TreeView);
      item.selectCommit(commit);
      const children = await item.getChildren();
      const folder = children.find(
        child => child instanceof ChangedFolderItem,
      ) as ChangedFolderItem;
      expect(folder.label).toBe('one');
      expect(folder.getChildren()[0].label).toBe('helper.ts');
      expect(children.filter(child => child instanceof ChangedFileItem)).toEqual([]);
    });

    it('does not display a late commit response after switching back to all commits', async () => {
      let resolve: (files: RestDiffFile[]) => void;
      jest.mocked(gitLabService.fetchFromApi).mockReturnValue(
        new Promise(done => {
          resolve = done;
        }),
      );
      item.selectCommit(commit);
      const slow = item.getChildren();
      item.selectCommit(undefined);
      resolve!([changedFile]);
      const result = await slow;
      expect(result.slice(2).every(child => child instanceof ChangedFileItem)).toBe(true);
    });

    it('keeps the latest selected commit when an earlier request finishes later', async () => {
      let resolve: (files: RestDiffFile[]) => void;
      jest.mocked(gitLabService.fetchFromApi).mockReturnValueOnce(
        new Promise(done => {
          resolve = done;
        }),
      );
      item.selectCommit(commit);
      const slow = item.getChildren();
      const latest = { ...commit, id: 'c'.repeat(40) };
      item.selectCommit(latest);
      await item.getChildren();
      resolve!([changedFile]);
      const result = await slow;
      const changed = result[3] as vscode.TreeItem;
      expect(fromReviewUri(changed.command!.arguments![1]).commit).toBe(latest.id);
      expect(gitLabService.fetchFromApi).toHaveBeenCalledTimes(2);
    });

    it('shares pending overall MR loads when switching to a commit and back quickly', async () => {
      let resolve: (discussions: []) => void;
      jest.mocked(gitLabService.getDiscussions).mockReturnValue(
        new Promise(done => {
          resolve = done;
        }),
      );
      const initial = item.getChildren();
      item.selectCommit(commit);
      await item.getChildren();
      item.selectCommit(undefined);
      const restored = item.getChildren();
      resolve!([]);
      const [before, after] = await Promise.all([initial, restored]);
      expect(before).toBe(after);
      expect(gitLabService.getMrDiff).toHaveBeenCalledTimes(1);
      expect(createCommentControllerMock).toHaveBeenCalledTimes(1);
    });

    it('shows a commit load error without falling back to the misleading overall MR file list', async () => {
      jest.mocked(gitLabService.fetchFromApi).mockRejectedValueOnce(new Error('offline'));
      item.selectCommit(commit);
      const children = await item.getChildren();
      expect(children[2]).toMatchObject({ label: expect.stringContaining('Could not load') });
      expect(children.some(child => child instanceof ChangedFileItem)).toBe(false);
      item.selectCommit(undefined);
      expect((await item.getChildren()).some(child => child instanceof ChangedFileItem)).toBe(true);
    });

    it('retries a failed selection and reuses a successfully loaded selection', async () => {
      jest.mocked(gitLabService.fetchFromApi).mockRejectedValueOnce(new Error('offline'));
      item.selectCommit(commit);
      await item.getChildren();
      item.selectCommit(commit);
      expect((await item.getChildren())[3]).toMatchObject({ label: 'helper.ts' });
      item.selectCommit(commit);
      await item.getChildren();
      expect(gitLabService.fetchFromApi).toHaveBeenCalledTimes(2);
    });
  });

  it('shares an in-flight diff version load between automatic preparation and expanding the MR', async () => {
    const version = item.getReviewVersion();
    await Promise.all([version, item.getChildren()]);
    expect(gitLabService.getMrDiff).toHaveBeenCalledTimes(1);
  });

  it('preserves MR identity through title changes and separates the same MR in different queries', () => {
    const first = new MrItemModel(mr, projectInRepository, 'query-a');
    const renamed = new MrItemModel(
      { ...mr, title: 'Updated title' },
      projectInRepository,
      'query-a',
    );
    const other = new MrItemModel(mr, projectInRepository, 'query-b');
    expect(first.getTreeItem().id).toBeTruthy();
    expect(first.getTreeItem().id).toBe(renamed.getTreeItem().id);
    expect(first.getTreeItem().id).not.toBe(other.getTreeItem().id);
  });

  describe('commenting range', () => {
    it('should not add a commenting range provider if user does not have permission to comment', async () => {
      canUserCommentOnMr = false;

      await item.getChildren();

      expect(commentController.commentingRangeProvider).toBe(undefined);
    });

    it('should add a commenting range provider if user has permission to comment', async () => {
      canUserCommentOnMr = true;

      await item.getChildren();

      expect(commentController.commentingRangeProvider).toBeInstanceOf(CommentingRangeProvider);
    });

    it('keeps the same commentController regardless how many times we call getChildren', async () => {
      await item.getChildren();

      expect(createCommentControllerMock).toHaveBeenCalledTimes(1);

      await item.getChildren();

      expect(createCommentControllerMock).toHaveBeenCalledTimes(1);
      expect(commentController.dispose).not.toHaveBeenCalled();
    });
  });
});
