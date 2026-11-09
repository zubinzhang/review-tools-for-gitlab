import * as vscode from 'vscode';
import { PROGRAMMATIC_COMMANDS } from '../../command_names';
import { ItemModel } from './item_model';

export interface ReviewCommit {
  id: string;
  title: string;
  message: string;
  author_name: string;
  committed_date: string;
  parent_ids: string[];
}

export interface CommitSelection {
  getSelected(): ReviewCommit | undefined;
  select(commit: ReviewCommit | undefined): void;
}

export class MrCommitItem extends ItemModel {
  constructor(
    readonly commit: ReviewCommit | undefined,
    private readonly parentId: string,
    private readonly selection: CommitSelection,
  ) {
    super();
  }

  getTreeItem(): vscode.TreeItem {
    const active = this.selection.getSelected()?.id === this.commit?.id;
    const item = new vscode.TreeItem(
      this.commit?.title ?? 'All commits',
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `${this.parentId}/commit/${this.commit?.id ?? 'all'}`;
    item.iconPath = new vscode.ThemeIcon(active ? 'check' : 'git-commit');
    item.description = this.commit
      ? `${this.commit.id.slice(0, 8)} · ${this.commit.author_name} · ${this.commit.committed_date}`
      : 'Entire merge request';
    item.tooltip = this.commit
      ? `${this.commit.id}\n${this.commit.author_name}\n${this.commit.committed_date}\n\n${this.commit.message}\n\nSelect to show this commit against its first parent in the MR file tree. Read-only; choose All commits to add MR comments.`
      : 'Show the entire MR diff, including inline comments and viewed-file state.';
    item.command = {
      command: PROGRAMMATIC_COMMANDS.SELECT_REVIEW_COMMIT,
      title: 'Select review commit',
      arguments: [this],
    };
    return item;
  }

  select(): void {
    this.selection.select(this.commit);
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    return [];
  }
}
