import * as vscode from 'vscode';
import { log } from '../../../common/log';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { ProjectInRepository } from '../../gitlab/new_project';
import { ErrorItem } from './error_item';
import { ItemModel } from './item_model';
import { MrCommitItem, ReviewCommit } from './mr_commit_item';

const pageSize = 100;

export class MrCommitsItem extends ItemModel {
  #pending?: Promise<(ItemModel | vscode.TreeItem)[]>;

  constructor(
    private readonly mr: RestMr,
    private readonly project: ProjectInRepository,
    private readonly parentId: string,
    private readonly page = 1,
  ) {
    super();
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      this.page === 1 ? 'Commits' : 'More commits…',
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = this.#id;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.tooltip =
      'Commits currently in this merge request. Expand a commit to compare it with its first parent.';
    return item;
  }

  get #id(): string {
    return `${this.parentId}/commits/page/${this.page}`;
  }

  getChildren(): Promise<(ItemModel | vscode.TreeItem)[]> {
    this.#pending ??= this.#load().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #load(): Promise<(ItemModel | vscode.TreeItem)[]> {
    try {
      const commits = await getGitLabService(this.project).fetchFromApi<ReviewCommit[]>({
        type: 'rest',
        method: 'GET',
        path: `/projects/${this.mr.project_id}/merge_requests/${this.mr.iid}/commits`,
        searchParams: { page: String(this.page), per_page: String(pageSize) },
      });
      if (!commits.length)
        return [new vscode.TreeItem(this.page === 1 ? 'No commits found.' : 'No more commits.')];
      const children: ItemModel[] = commits.map(
        commit => new MrCommitItem(commit, this.mr, this.project, this.#id),
      );
      if (commits.length === pageSize)
        children.push(new MrCommitsItem(this.mr, this.project, this.parentId, this.page + 1));
      this.setDisposableChildren(children);
      return children;
    } catch (error) {
      log.error('Failed to load MR commits.', error);
      return [new ErrorItem('Could not load commits. Collapse and expand to retry.')];
    }
  }
}
