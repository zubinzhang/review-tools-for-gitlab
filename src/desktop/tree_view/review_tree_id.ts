import { ProjectInRepository } from '../gitlab/new_project';
import { canonicalReviewPath } from '../review/review_worktree';

export function reviewProjectId(project: ProjectInRepository): string {
  return `review-project:${JSON.stringify([
    canonicalReviewPath(project.pointer.repository.rootFsPath),
    project.account.instanceUrl,
    project.account.id,
    project.project.restId,
    project.pointer.remote.name,
  ])}`;
}
