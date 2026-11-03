import * as path from 'path';
import * as vscode from 'vscode';
import { VS_COMMANDS } from '../../common/command_names';
import { GitLabProject } from '../../common/platform/gitlab_project';
import { ProjectInRepository } from '../gitlab/new_project';
import { getGitLabService } from '../gitlab/get_gitlab_service';
import { getTrackingBranchName } from '../git/get_tracking_branch_name';
import { getTagsForHead } from '../git/get_tags_for_head';
import { getLastCommitSha } from '../git/get_last_commit_sha';
import { DetachedHeadError } from '../errors/detached_head_error';
import { Repository } from '../api/git';
import { WarningError } from '../errors/warning_error';
import { getProjectWithRepositoryInfo } from '../gitlab/api/get_projects_with_repository_info';
import { getPipelineAndMrForBranch } from '../gitlab/get_pipeline_and_mr_for_branch';
import { currentUserRequest } from '../../common/gitlab/api/get_current_user';
import { findOpenMrForCurrentBranch } from '../gitlab/utils/mr_lookup_helpers';
import {
  ProjectCommand,
  ProjectFileCommand,
  ProjectInRepositoryAndFile,
} from './run_with_valid_project';

export const openUrl = async (url: string): Promise<void> => {
  await vscode.commands.executeCommand(VS_COMMANDS.OPEN, url);
};

/**
 * Fetches user and project before opening a link.
 * Link can contain some placeholders which will be replaced by this method
 * with relevant information. Implemented placeholders below.
 *
 * $projectUrl
 * $userId
 *
 * An example link is `$projectUrl/-/issues?assignee_id=$userId` which will be
 * `gitlab.com/gitlab-org/gitlab-ce/-/issues?assignee_id=502136`.
 *
 * @param {string} linkTemplate
 * @param {RestUser} user current user
 * @param {GitLabProject} project
 */
async function getLink(linkTemplate: string, user: RestUser, project: GitLabProject) {
  return linkTemplate.replace('$userId', user.id.toString()).replace('$projectUrl', project.webUrl);
}

async function openTemplatedLink(linkTemplate: string, projectInRepository: ProjectInRepository) {
  const user = await getGitLabService(projectInRepository).fetchFromApi(currentUserRequest);
  await openUrl(await getLink(linkTemplate, user, projectInRepository.project));
}

async function getTrackingBranchNameOrThrow(rawRepository: Repository): Promise<string> {
  const branchName = await getTrackingBranchName(rawRepository);
  if (!branchName) throw new DetachedHeadError();
  return branchName;
}

export const showIssues: ProjectCommand = async projectInRepository => {
  await openTemplatedLink('$projectUrl/-/issues?assignee_id=$userId', projectInRepository);
};

export const showMergeRequests: ProjectCommand = async projectInRepository => {
  await openTemplatedLink('$projectUrl/-/merge_requests?assignee_id=$userId', projectInRepository);
};

async function getActiveFile(
  { projectInRepository, activeEditor }: ProjectInRepositoryAndFile,
  linkType: 'permalink' | 'branch' = 'permalink',
): Promise<string> {
  const { repository } = projectInRepository.pointer;

  const repoPath = repository.rootFsPath;
  const editorPath = activeEditor.document.uri.fsPath;
  if (!editorPath.startsWith(repoPath)) {
    throw new WarningError('The current file is not in the project repository.');
  }
  const filePath = path.relative(repoPath, editorPath).replace(/\\/g, '/');

  const log = await repository.rawRepository.log({ maxEntries: 1, path: filePath });

  if (log.length === 0) {
    throw new WarningError(
      'No link exists for the current file. Commit the current file to the repository.',
    );
  }
  const { project } = projectInRepository;
  const ref =
    linkType === 'permalink'
      ? log[0].hash
      : await getTrackingBranchNameOrThrow(repository.rawRepository);

  const fileUrl = `${project.webUrl}/-/blob/${encodeURIComponent(ref)}/${filePath}`;
  let anchor = '';

  if (activeEditor.selection) {
    const { start, end } = activeEditor.selection;
    anchor = `#L${start.line + 1}`;

    if (end.line > start.line) {
      anchor += `-${end.line + 1}`;
    }
  }

  return `${fileUrl}${anchor}`;
}

export const openActiveFile: ProjectFileCommand = async projectInRepositoryAndFile => {
  await openUrl(await getActiveFile(projectInRepositoryAndFile));
};

export const copyLinkToActiveFile: ProjectFileCommand = async projectInRepositoryAndFile => {
  const fileUrl = await getActiveFile(projectInRepositoryAndFile);
  await vscode.env.clipboard.writeText(fileUrl);
};

export const copyLinkToActiveFileOnBranch: ProjectFileCommand =
  async projectInRepositoryAndFile => {
    const fileUrl = await getActiveFile(projectInRepositoryAndFile, 'branch');
    await vscode.env.clipboard.writeText(fileUrl);
  };

/**
 * Command that opens specific commit. Used by SourceControlHistoryItemDetailsProvider.
 */
export const openCommitInGitLab = async (projectUrl: string, commit: string): Promise<void> => {
  const url = `${projectUrl}/-/commit/${commit}`;
  await openUrl(url);
};

export const openCurrentMergeRequest: ProjectCommand = async projectInRepository => {
  const gitlabService = getGitLabService(projectInRepository);
  const { project, pointer } = projectInRepository;
  const trackingBranchName = await getTrackingBranchNameOrThrow(pointer.repository.rawRepository);
  const mr = await findOpenMrForCurrentBranch(gitlabService, project, trackingBranchName);

  if (mr) {
    await openUrl(mr.web_url);
  }
};

export const openCreateNewIssue: ProjectCommand = async projectInRepository => {
  await openTemplatedLink('$projectUrl/-/issues/new', projectInRepository);
};

export const openProjectPage: ProjectCommand = async projectInRepository => {
  await openTemplatedLink('$projectUrl', projectInRepository);
};

export async function openCurrentPipeline(projectInRepository: ProjectInRepository): Promise<void> {
  const { rawRepository } = projectInRepository.pointer.repository;
  const branchName = await getTrackingBranchNameOrThrow(rawRepository);
  const tags = await getTagsForHead(rawRepository).catch(() => []);
  const { pipeline } = await getPipelineAndMrForBranch(
    getGitLabService(projectInRepository),
    projectInRepository.project,
    branchName,
    tags,
  );

  if (pipeline) {
    await openUrl(pipeline.web_url);
  }
}

export const compareCurrentBranch: ProjectCommand = async projectInRepository => {
  const { project } = projectInRepository;
  const { repository } = projectInRepository.pointer;

  const projectWithRepoInfoResult = await getGitLabService(projectInRepository).fetchFromApi(
    getProjectWithRepositoryInfo(project.namespaceWithPath),
  );
  const projectWithRepoInfo = projectWithRepoInfoResult.project;
  if (!projectWithRepoInfo) {
    throw new Error(
      `Could not load project ${project.namespaceWithPath} from API, please try again.`,
    );
  }

  if (getLastCommitSha(repository.rawRepository) && projectWithRepoInfo.repository?.rootRef) {
    await openUrl(
      `${project.webUrl}/-/compare/${projectWithRepoInfo.repository.rootRef}...${getLastCommitSha(
        repository.rawRepository,
      )}`,
    );
  }
};

export const showErrorMessage = async (message: string) => {
  await vscode.window.showErrorMessage(message);
};
