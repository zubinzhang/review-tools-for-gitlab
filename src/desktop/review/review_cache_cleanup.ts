import * as vscode from 'vscode';
import { log } from '../../common/log';
import { getProjectRepository } from '../gitlab/gitlab_project_repository';
import { getGitLabService } from '../gitlab/get_gitlab_service';
import {
  canonicalReviewPath,
  ReviewWorktreeManager,
  ReviewWorktreeRequest,
  ReviewWorktreeSnapshot,
} from './review_worktree';
import { ReviewWorkspace } from './review_workspace';

export async function getReviewMrState(
  request: ReviewWorktreeRequest,
): Promise<RestMr['state'] | undefined> {
  const project = getProjectRepository().getProjectOrFail(request.repositoryRoot);
  if (
    project.project.restId !== request.projectId ||
    project.pointer.remote.name !== request.remoteName
  )
    return undefined;
  const mr = await getGitLabService(project).fetchFromApi<RestMr>({
    type: 'rest',
    method: 'GET',
    path: `/projects/${request.projectId}/merge_requests/${request.mrIid}`,
  });
  return mr.id === request.mrId && mr.iid === request.mrIid && mr.project_id === request.projectId
    ? mr.state
    : undefined;
}

export class ReviewCacheCleanup {
  #pending?: Promise<void>;

  #checked = new Map<string, number>();

  constructor(
    private readonly manager: ReviewWorktreeManager,
    private readonly workspace: ReviewWorkspace,
    private readonly resolveState = getReviewMrState,
  ) {}

  run(): Promise<void> {
    if (!vscode.workspace.isTrusted) return Promise.resolve();
    if (this.#pending) return this.#pending;
    this.#pending = this.#inspect().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #inspect(): Promise<void> {
    const snapshots = await this.manager.listPrepared();
    const grouped = new Map<string, ReviewWorktreeSnapshot[]>();
    for (const snapshot of snapshots) {
      const { request } = snapshot;
      const key = JSON.stringify([
        canonicalReviewPath(request.repositoryRoot),
        request.projectId,
        request.mrId,
      ]);
      if (Date.now() - (this.#checked.get(key) ?? -Infinity) < 300000) continue;
      grouped.set(key, [...(grouped.get(key) ?? []), snapshot]);
    }
    const queue = [...grouped];
    const worker = async (): Promise<void> => {
      const group = queue.shift();
      if (!group || !vscode.workspace.isTrusted) return;
      const [key, candidates] = group;
      try {
        const state = await this.resolveState(candidates[0].request);
        if (state === 'opened') {
          this.#checked.set(key, Date.now());
          const revisions = new Map<string, ReviewWorktreeSnapshot[]>();
          for (const snapshot of candidates)
            revisions.set(snapshot.request.commit, [
              ...(revisions.get(snapshot.request.commit) ?? []),
              snapshot,
            ]);
          const duplicates = [...revisions.values()].flatMap(revision => {
            if (revision.length < 2) return [];
            const preferred = canonicalReviewPath(this.manager.getPath(revision[0].request));
            const keep =
              revision.find(snapshot => canonicalReviewPath(snapshot.root) === preferred) ??
              revision[0];
            return revision.filter(snapshot => snapshot !== keep);
          });
          await this.#remove(duplicates);
        }
        if (state === 'closed' || state === 'merged') await this.#remove(candidates);
      } catch {
        log.debug('Skipping review cache cleanup because the MR state could not be verified.');
      }
      await worker();
    };
    await Promise.all([worker(), worker()]);
  }

  async #remove(candidates: ReviewWorktreeSnapshot[], index = 0): Promise<void> {
    const snapshot = candidates[index];
    if (!snapshot) return;
    if (!this.workspace.isActive(snapshot.root) && (await this.workspace.detach(snapshot.root))) {
      await this.manager.removePrepared(
        snapshot,
        () =>
          vscode.workspace.isTrusted &&
          !this.workspace.isIncluded(snapshot.root) &&
          !this.workspace.isActive(snapshot.root),
      );
    }
    await this.#remove(candidates, index + 1);
  }
}
