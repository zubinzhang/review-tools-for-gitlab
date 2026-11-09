import * as vscode from 'vscode';
import { createFakePartial } from '../../../common/test_utils/create_fake_partial';
import { mr, projectInRepository, diffFile } from '../../test_utils/entities';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { GitLabService } from '../../gitlab/gitlab_service';
import { fromReviewUri, isEmptyFileUri } from '../../review/review_uri';
import { MrCommitsItem } from './mr_commits_item';
import { MrCommitItem, ReviewCommit } from './mr_commit_item';
import { ErrorItem } from './error_item';

jest.mock('../../gitlab/get_gitlab_service');

describe('MR commit browsing', () => {
  const commit: ReviewCommit = {
    id: 'a'.repeat(40),
    title: 'Add a helper',
    message: 'Add a helper\n\nImplementation details.',
    author_name: 'Reviewer',
    committed_date: '2026-11-09T04:00:00Z',
    parent_ids: ['b'.repeat(40), 'c'.repeat(40)],
  };
  let service: GitLabService;

  beforeEach(() => {
    service = createFakePartial<GitLabService>({ fetchFromApi: jest.fn() });
    jest.mocked(getGitLabService).mockReturnValue(service);
  });

  it('loads commits lazily from the target project and MR IID, and shows commit metadata', async () => {
    const item = new MrCommitsItem(mr, projectInRepository, 'mr-tree-id');
    expect(item.getTreeItem().label).toBe('Commits');
    expect(item.getTreeItem().collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(service.fetchFromApi).not.toHaveBeenCalled();
    jest.mocked(service.fetchFromApi).mockResolvedValue([commit]);
    const [child] = await item.getChildren();
    expect(service.fetchFromApi).toHaveBeenCalledWith({
      type: 'rest',
      method: 'GET',
      path: `/projects/${mr.project_id}/merge_requests/${mr.iid}/commits`,
      searchParams: { page: '1', per_page: '100' },
    });
    expect(child).toBeInstanceOf(MrCommitItem);
    const rendered = (child as MrCommitItem).getTreeItem();
    expect(rendered.label).toContain(commit.title);
    expect(rendered.description).toContain(commit.id.slice(0, 8));
    expect(rendered.description).toContain(commit.author_name);
    expect(rendered.tooltip).toContain(commit.committed_date);
    expect(rendered.tooltip).toContain(commit.message);
  });

  it('offers the next page only for a full page and coalesces concurrent expansion', async () => {
    const commits = Array.from({ length: 100 }, (_, index) => ({
      ...commit,
      id: index.toString(16).padStart(40, '0'),
    }));
    jest.mocked(service.fetchFromApi).mockResolvedValue(commits);
    const item = new MrCommitsItem(mr, projectInRepository, 'mr-tree-id');
    const [children] = await Promise.all([item.getChildren(), item.getChildren()]);
    expect(service.fetchFromApi).toHaveBeenCalledTimes(1);
    const more = children[100] as MrCommitsItem;
    expect(more.getTreeItem().label).toBe('More commits…');
    jest.mocked(service.fetchFromApi).mockResolvedValue([commit]);
    expect(await more.getChildren()).toHaveLength(1);
    expect(service.fetchFromApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchParams: { page: '2', per_page: '100' } }),
    );
  });

  it('shows a recoverable error and can retry after failure', async () => {
    const item = new MrCommitsItem(mr, projectInRepository, 'mr-tree-id');
    jest
      .mocked(service.fetchFromApi)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    expect((await item.getChildren())[0]).toBeInstanceOf(ErrorItem);
    expect((await item.getChildren())[0]).toMatchObject({ label: 'No commits found.' });
  });

  it('keeps tree IDs distinct across MRs and query branches', async () => {
    jest.mocked(service.fetchFromApi).mockResolvedValue([commit]);
    const first = await new MrCommitsItem(mr, projectInRepository, 'query-a/mr-1').getChildren();
    const second = await new MrCommitsItem(mr, projectInRepository, 'query-b/mr-1').getChildren();
    expect((first[0] as MrCommitItem).getTreeItem().id).not.toBe(
      (second[0] as MrCommitItem).getTreeItem().id,
    );
  });

  it.each([
    { name: 'modified', new_file: false, deleted_file: false, renamed_file: false },
    { name: 'added', new_file: true, deleted_file: false, renamed_file: false },
    { name: 'deleted', new_file: false, deleted_file: true, renamed_file: false },
    { name: 'renamed', new_file: false, deleted_file: false, renamed_file: true },
  ])(
    'opens a $name file at the exact commit and first parent without MR viewed flags',
    async flags => {
      const file = { ...diffFile, ...flags, old_path: 'old/name.ts', new_path: 'new/name.ts' };
      jest.mocked(service.fetchFromApi).mockResolvedValue([file]);
      const item = new MrCommitItem(commit, mr, projectInRepository, 'commits');
      const children = await item.getChildren();
      const changed = children.find(
        child => child instanceof vscode.TreeItem && child.command?.command === 'vscode.diff',
      ) as vscode.TreeItem;
      expect(changed).toBeDefined();
      const [baseUri, headUri, title] = changed.command!.arguments!;
      expect(fromReviewUri(baseUri)).toMatchObject({
        commit: commit.parent_ids[0],
        path: '/old/name.ts',
        exists: !flags.new_file,
        comparison: 'commit',
      });
      expect(fromReviewUri(headUri)).toMatchObject({
        commit: commit.id,
        path: '/new/name.ts',
        exists: !flags.deleted_file,
        comparison: 'commit',
      });
      expect(title).toContain(commit.id.slice(0, 8));
      expect(changed.checkboxState).toBeUndefined();
      expect(service.fetchFromApi).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/projects/${mr.project_id}/repository/commits/${commit.id}/diff`,
        }),
      );
    },
  );

  it('uses an empty left side for an initial commit', async () => {
    jest.mocked(service.fetchFromApi).mockResolvedValue([{ ...diffFile, new_file: true }]);
    const children = await new MrCommitItem(
      { ...commit, parent_ids: [] },
      mr,
      projectInRepository,
      'commits',
    ).getChildren();
    const changed = children[1] as vscode.TreeItem;
    expect(isEmptyFileUri(changed.command!.arguments![0])).toBe(true);
  });

  it('paginates changed files and labels the first-parent comparison for merge commits', async () => {
    jest
      .mocked(service.fetchFromApi)
      .mockResolvedValue(
        Array.from({ length: 100 }, (_, index) => ({ ...diffFile, new_path: `file-${index}.ts` })),
      );
    const item = new MrCommitItem(commit, mr, projectInRepository, 'commits');
    expect(item.getTreeItem().tooltip).toContain('first parent');
    const children = await item.getChildren();
    const more = children[101] as MrCommitItem;
    expect(more.getTreeItem().label).toBe('More files…');
    jest.mocked(service.fetchFromApi).mockResolvedValue([]);
    await more.getChildren();
    expect(service.fetchFromApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchParams: { page: '2', per_page: '100' } }),
    );
  });

  it('provides a GitLab link when the server omits diff content', async () => {
    jest.mocked(service.fetchFromApi).mockResolvedValue([{ ...diffFile, diff: '' }]);
    const children = await new MrCommitItem(
      commit,
      mr,
      projectInRepository,
      'commits',
    ).getChildren();
    expect(children[0]).toMatchObject({ label: 'Open commit in GitLab' });
    expect(
      children.some(
        child => child instanceof vscode.TreeItem && String(child.label).includes('diff limits'),
      ),
    ).toBe(true);
  });

  it('refuses malformed commit identities before querying a repository endpoint', async () => {
    const item = new MrCommitItem({ ...commit, id: '../HEAD' }, mr, projectInRepository, 'commits');
    expect((await item.getChildren())[0]).toBeInstanceOf(ErrorItem);
    expect(service.fetchFromApi).not.toHaveBeenCalled();
  });
});
