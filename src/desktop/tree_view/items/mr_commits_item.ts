import * as vscode from 'vscode';
import { log } from '../../../common/log';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { ProjectInRepository } from '../../gitlab/new_project';
import { ErrorItem } from './error_item';
import { ItemModel } from './item_model';
import { MrCommitItem, ReviewCommit, CommitSelection } from './mr_commit_item';

const pageSize = 100;

export class MrCommitsItem extends ItemModel {
  #pending?: Promise<(ItemModel | vscode.TreeItem)[]>;

  #children?: (ItemModel | vscode.TreeItem)[];

  constructor(
    private readonly mr: RestMr,
    private readonly project: ProjectInRepository,
    private readonly parentId: string,
    private readonly selection: CommitSelection,
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
    item.description = this.selection.getSelected()?.id.slice(0, 8) ?? 'All commits';
    item.tooltip = 'Select All commits or one commit to update the MR file tree below.';
    return item;
  }

  get #id(): string {
    return `${this.parentId}/commits/page/${this.page}`;
  }

  getChildren(): Promise<(ItemModel | vscode.TreeItem)[]> {
    if (this.#children) return Promise.resolve(this.#children);
    this.#pending ??= this.#load().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #load(): Promise<(ItemModel | vscode.TreeItem)[]> {
    const all = this.page === 1 ? [new MrCommitItem(undefined, this.#id, this.selection)] : [];
    try {
      const commits = await getGitLabService(this.project).fetchFromApi<ReviewCommit[]>({
        type: 'rest',
        method: 'GET',
        path: `/projects/${this.mr.project_id}/merge_requests/${this.mr.iid}/commits`,
        searchParams: { page: String(this.page), per_page: String(pageSize) },
      });
      const children: ItemModel[] = [
        ...all,
        ...commits.map(commit => new MrCommitItem(commit, this.#id, this.selection)),
      ];
      if (commits.length === pageSize)
        children.push(
          new MrCommitsItem(this.mr, this.project, this.parentId, this.selection, this.page + 1),
        );
      this.setDisposableChildren(children);
      this.#children = commits.length
        ? children
        : [...all, new vscode.TreeItem(this.page === 1 ? 'No commits found.' : 'No more commits.')];
      return this.#children;
    } catch (error) {
      log.error('Failed to load MR commits.', error);
      return [...all, new ErrorItem('Could not load commits. Collapse and expand to retry.')];
    }
  }
}
