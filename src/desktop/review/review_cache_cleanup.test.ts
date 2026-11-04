import * as vscode from 'vscode';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { getProjectRepository, GitLabProjectRepository } from '../gitlab/gitlab_project_repository';
import { getGitLabService } from '../gitlab/get_gitlab_service';
import { GitLabService } from '../gitlab/gitlab_service';
import { projectInRepository } from '../test_utils/entities';
import { getReviewMrState, ReviewCacheCleanup } from './review_cache_cleanup';
import { ReviewWorkspace } from './review_workspace';
import { ReviewWorktreeManager, ReviewWorktreeRequest } from './review_worktree';

jest.mock('../gitlab/gitlab_project_repository');
jest.mock('../gitlab/get_gitlab_service');

describe('Review cache status checks', () => {
  const request: ReviewWorktreeRequest = {
    repositoryRoot: '/original',
    projectId: 10,
    mrId: 100,
    mrIid: 7,
    remoteName: 'origin',
    commit: 'a'.repeat(40),
  };
  let service: GitLabService;

  beforeEach(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    jest.mocked(getProjectRepository).mockReturnValue(
      createFakePartial<GitLabProjectRepository>({
        getProjectOrFail: jest.fn().mockReturnValue({
          ...projectInRepository,
          project: { ...projectInRepository.project, restId: 10 },
          pointer: { ...projectInRepository.pointer, remote: { name: 'origin' } },
        }),
      }),
    );
    service = createFakePartial<GitLabService>({
      fetchFromApi: jest
        .fn()
        .mockResolvedValue({ id: 100, iid: 7, project_id: 10, state: 'merged' }),
    });
    jest.mocked(getGitLabService).mockReturnValue(service);
  });

  it('queries the exact project and MR IID rather than assuming disappearance from a list', async () => {
    expect(await getReviewMrState(request)).toBe('merged');
    expect(service.fetchFromApi).toHaveBeenCalledWith({
      type: 'rest',
      method: 'GET',
      path: '/projects/10/merge_requests/7',
    });
  });

  it.each([{ projectId: 20 }, { remoteName: 'other' }])(
    'skips a changed project or remote %j',
    async change => {
      expect(await getReviewMrState({ ...request, ...change })).toBeUndefined();
      expect(service.fetchFromApi).not.toHaveBeenCalled();
    },
  );

  it.each([{ id: 999 }, { iid: 8 }, { project_id: 20 }])(
    'does not trust mismatched MR identity %j',
    async change => {
      jest
        .mocked(service.fetchFromApi)
        .mockResolvedValue({ id: 100, iid: 7, project_id: 10, state: 'closed', ...change });
      expect(await getReviewMrState(request)).toBeUndefined();
    },
  );

  it('limits status requests to two at a time, shares concurrent runs and throttles unchanged open MRs', async () => {
    const manager = createFakePartial<ReviewWorktreeManager>({
      listPrepared: jest.fn().mockResolvedValue(
        Array.from({ length: 5 }, (_, index) => ({
          root: `/cache/${index}`,
          request: { ...request, mrId: 100 + index },
        })),
      ),
    });
    let active = 0;
    let maximum = 0;
    const resolve = jest.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>(done => {
        setImmediate(done);
      });
      active -= 1;
      return 'opened' as const;
    });
    const cleanup = new ReviewCacheCleanup(
      manager,
      createFakePartial<ReviewWorkspace>({}),
      resolve,
    );
    await Promise.all([cleanup.run(), cleanup.run()]);
    expect(manager.listPrepared).toHaveBeenCalledTimes(1);
    expect(maximum).toBe(2);
    expect(resolve).toHaveBeenCalledTimes(5);
    await cleanup.run();
    expect(resolve).toHaveBeenCalledTimes(5);
  });

  it('does not scan or query GitLab in an untrusted workspace', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: false });
    const manager = createFakePartial<ReviewWorktreeManager>({ listPrepared: jest.fn() });
    const resolve = jest.fn();
    await new ReviewCacheCleanup(manager, createFakePartial<ReviewWorkspace>({}), resolve).run();
    expect(manager.listPrepared).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
