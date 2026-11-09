import * as path from 'node:path';
import * as vscode from 'vscode';
import { log } from '../../../common/log';
import { USER_COMMANDS } from '../../command_names';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { ProjectInRepository } from '../../gitlab/new_project';
import { toReviewUri } from '../../review/review_uri';
import { getChangeType } from './changed_file_item';
import { ErrorItem } from './error_item';
import { ItemModel } from './item_model';

export interface ReviewCommit {
  id: string;
  title: string;
  message: string;
  author_name: string;
  committed_date: string;
  parent_ids: string[];
}

const pageSize = 100;
const isCommitSha = (sha: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha);

export class MrCommitItem extends ItemModel {
  #pending?: Promise<(ItemModel | vscode.TreeItem)[]>;

  constructor(
    private readonly commit: ReviewCommit,
    private readonly mr: RestMr,
    private readonly project: ProjectInRepository,
    private readonly parentId: string,
    private readonly page = 1,
  ) {
    super();
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      this.page === 1 ? this.commit.title : 'More files…',
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `${this.parentId}/commit/${this.commit.id}/page/${this.page}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.description = `${this.commit.id.slice(0, 8)} · ${this.commit.author_name} · ${this.commit.committed_date}`;
    item.tooltip = `${this.commit.id}\n${this.commit.author_name}\n${this.commit.committed_date}\n\n${this.commit.message}\n\nRead-only comparison against the first parent. Add MR comments in the overall MR diff. GitLab may limit the returned file list.`;
    return item;
  }

  getChildren(): Promise<(ItemModel | vscode.TreeItem)[]> {
    this.#pending ??= this.#load().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #load(): Promise<(ItemModel | vscode.TreeItem)[]> {
    try {
      if (
        !isCommitSha(this.commit.id) ||
        !Array.isArray(this.commit.parent_ids) ||
        this.commit.parent_ids.some(parent => !isCommitSha(parent))
      )
        throw new Error('Invalid commit or parent SHA. Refresh the MR commit list.');
      const files = await getGitLabService(this.project).fetchFromApi<RestDiffFile[]>({
        type: 'rest',
        method: 'GET',
        path: `/projects/${this.mr.project_id}/repository/commits/${this.commit.id}/diff`,
        searchParams: { page: String(this.page), per_page: String(pageSize) },
      });
      const children: (ItemModel | vscode.TreeItem)[] = [];
      if (this.page === 1) {
        const link = new vscode.TreeItem('Open commit in GitLab');
        link.iconPath = new vscode.ThemeIcon('link-external');
        link.command = {
          command: USER_COMMANDS.OPEN_COMMIT_IN_GITLAB,
          title: 'Open commit in GitLab',
          arguments: [this.project.project.webUrl, this.commit.id],
        };
        children.push(link);
      }
      children.push(...files.map(file => this.#fileItem(file)));
      if (!files.length) children.push(new vscode.TreeItem('No changed files returned by GitLab.'));
      if (files.some(file => !file.diff))
        children.push(
          new vscode.TreeItem(
            'GitLab diff limits or binary files may omit details. See the commit in GitLab.',
          ),
        );
      if (files.length === pageSize)
        children.push(
          new MrCommitItem(this.commit, this.mr, this.project, this.parentId, this.page + 1),
        );
      return children;
    } catch (error) {
      log.error('Failed to load commit changes.', error);
      return [new ErrorItem('Could not load commit changes. Collapse and expand to retry.')];
    }
  }

  #fileItem(file: RestDiffFile): vscode.TreeItem {
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
    const item = new vscode.TreeItem(path.posix.basename(file.new_path || file.old_path));
    item.id = `${this.getTreeItem().id}/file/${file.old_path}:${file.new_path}`;
    item.description = `${getChangeType(file)} · ${file.new_path || file.old_path}`;
    item.tooltip = `${file.old_path} → ${file.new_path}\nRead-only commit diff. Add MR comments in the overall MR diff.`;
    item.iconPath = vscode.ThemeIcon.File;
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
