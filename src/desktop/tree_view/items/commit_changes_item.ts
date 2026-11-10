import * as path from 'node:path';
import * as vscode from 'vscode';
import { log } from '../../../common/log';
import { USER_COMMANDS } from '../../command_names';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { ProjectInRepository } from '../../gitlab/new_project';
import { toReviewUri } from '../../review/review_uri';
import { getSidebarViewState, SidebarViewState } from '../sidebar_view_state';
import { DiffFileItem, getChangeType } from './diff_file_item';
import { ErrorItem } from './error_item';
import { ReviewCommit } from './mr_commit_item';
import { ChangedFolderItem } from './changed_folder_item';

const pageSize = 100;
const isCommitSha = (sha: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha);

export class CommitChangesItem {
  #pending?: Promise<RestDiffFile[]>;

  #files?: RestDiffFile[];

  #repeatedPage = false;

  constructor(
    private readonly commit: ReviewCommit,
    private readonly mr: RestMr,
    private readonly project: ProjectInRepository,
    private readonly parentId: string,
  ) {}

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      if (
        !isCommitSha(this.commit.id) ||
        !Array.isArray(this.commit.parent_ids) ||
        this.commit.parent_ids.some(parent => !isCommitSha(parent))
      )
        throw new Error('Invalid commit or parent SHA. Refresh the MR commit list.');
      if (!this.#files) {
        this.#pending ??= this.#loadPages().finally(() => {
          this.#pending = undefined;
        });
        this.#files = await this.#pending;
      }
      const files = this.#files;
      const children: vscode.TreeItem[] = [];
      const link = new vscode.TreeItem('Open commit in GitLab');
      link.iconPath = new vscode.ThemeIcon('link-external');
      link.command = {
        command: USER_COMMANDS.OPEN_COMMIT_IN_GITLAB,
        title: 'Open commit in GitLab',
        arguments: [this.project.project.webUrl, this.commit.id],
      };
      children.push(link);
      const shownInList = getSidebarViewState() === SidebarViewState.ListView;
      const changed = files.map(file => ({
        path: file.new_path || file.old_path,
        item: this.#fileItem(file, shownInList),
      }));
      children.push(
        ...(shownInList
          ? changed.map(file => file.item)
          : new ChangedFolderItem('', changed).getChildren()),
      );
      if (!files.length) children.push(new vscode.TreeItem('No changed files returned by GitLab.'));
      if (this.#repeatedPage || files.some(file => !file.diff))
        children.push(
          new vscode.TreeItem(
            'GitLab diff limits or binary files may omit details. See the commit in GitLab.',
          ),
        );
      return children;
    } catch (error) {
      log.error('Failed to load commit changes.', error);
      return [new ErrorItem('Could not load commit changes. Select the commit again to retry.')];
    }
  }

  async #loadPages(page = 1, seen = new Set<string>()): Promise<RestDiffFile[]> {
    const files = await getGitLabService(this.project).fetchFromApi<RestDiffFile[]>({
      type: 'rest',
      method: 'GET',
      path: `/projects/${this.mr.project_id}/repository/commits/${this.commit.id}/diff`,
      searchParams: { page: String(page), per_page: String(pageSize) },
    });
    const unique = files.filter(file => {
      const key = JSON.stringify([file.old_path, file.new_path]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (files.length < pageSize) return unique;
    if (!unique.length) {
      this.#repeatedPage = true;
      return [];
    }
    return [...unique, ...(await this.#loadPages(page + 1, seen))];
  }

  #fileItem(file: RestDiffFile, shownInList: boolean): vscode.TreeItem {
    const parent = this.commit.parent_ids[0];
    const common = {
      repositoryRoot: this.project.pointer.repository.rootFsPath,
      projectId: this.mr.project_id,
      mrId: this.mr.id,
      changeType: getChangeType(file),
      comparison: 'commit' as const,
    };
    const original = toReviewUri({
      ...common,
      path: `/${file.old_path}`,
      commit: parent,
      exists: Boolean(parent) && !file.new_file,
      side: 'base',
    });
    const modified = toReviewUri({
      ...common,
      path: `/${file.new_path}`,
      commit: this.commit.id,
      exists: !file.deleted_file,
      side: 'head',
    });
    const item = new DiffFileItem(file, shownInList);
    item.id = `${this.parentId}/commit/${this.commit.id}/file/${file.old_path}:${file.new_path}`;
    item.tooltip = `${file.old_path} → ${file.new_path}\nRead-only commit diff. Add MR comments in the overall MR diff.`;
    item.contextValue = 'commit-file-item';
    item.command = {
      command: 'vscode.diff',
      title: 'Show commit changes',
      arguments: [
        original,
        modified,
        `${path.posix.basename(file.new_path || file.old_path)} (${this.commit.id.slice(0, 8)} · !${this.mr.iid})`,
      ],
    };
    return item;
  }
}
