import * as vscode from 'vscode';
import { handleError } from '../../common/errors/handle_error';
import { IssuableDataProvider, ReviewTreeElement } from '../tree_view/issuable_data_provider';
import { MrItemModel } from '../tree_view/items/mr_item_model';
import { ReviewNavigation } from './review_navigation';
import { ReviewWorkspace } from './review_workspace';
import { ReviewWorktreeRequest } from './review_worktree';

export class ReviewTreeController {
  #active?: MrItemModel;

  #generation = 0;

  #preparing?: Promise<void>;

  #restoring?: Promise<void>;

  readonly #key: string;

  constructor(
    private readonly tree: vscode.TreeView<ReviewTreeElement>,
    private readonly provider: IssuableDataProvider,
    private readonly navigation: ReviewNavigation,
    private readonly workspace: ReviewWorkspace,
    private readonly state: vscode.Memento,
  ) {
    this.#key = `review.sidebarSelection:${vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'empty'}`;
  }

  listen(): vscode.Disposable {
    return vscode.Disposable.from(
      this.tree.onDidChangeSelection(event => {
        const item = this.#findMr(event.selection[0]);
        if (item && (item !== this.#active || event.selection[0] === item))
          this.select(item).catch(handleError);
        else if (!item && event.selection.length) this.#clearSelection();
      }),
      this.tree.onDidExpandElement(event => {
        if (event.element instanceof MrItemModel) this.select(event.element).catch(handleError);
      }),
      this.tree.onDidCollapseElement(event => {
        if (event.element === this.#active) {
          this.#clearSelection();
        }
      }),
      this.tree.onDidChangeVisibility(event => {
        if (!event.visible) this.#deactivate();
        else this.restore().catch(handleError);
      }),
      new vscode.Disposable(() => this.#deactivate()),
    );
  }

  select(item: MrItemModel): Promise<void> {
    if (!vscode.workspace.isTrusted) return Promise.resolve();
    if (this.#active === item && this.#preparing) return this.#preparing;
    this.#active = item;
    const generation = ++this.#generation;
    this.workspace.setSelectedReview(undefined);
    this.#preparing = this.#prepare(item, generation).finally(() => {
      if (generation === this.#generation) this.#preparing = undefined;
    });
    return this.#preparing;
  }

  async #prepare(item: MrItemModel, generation: number): Promise<void> {
    const path = this.provider.getElementPath(item);
    if (path) await this.state.update(this.#key, path);
    if (generation !== this.#generation) return;
    const version = await item.getReviewVersion();
    if (generation !== this.#generation || !vscode.workspace.isTrusted) return;
    const request: ReviewWorktreeRequest = {
      repositoryRoot: item.projectInRepository.pointer.repository.rootFsPath,
      projectId: item.mr.project_id,
      mrId: item.mr.id,
      mrIid: item.mr.iid,
      remoteName: item.projectInRepository.pointer.remote.name,
      commit: version.head_commit_sha,
    };
    this.workspace.setSelectedReview(request);
    await this.navigation.prepareReview(request);
  }

  restore(): Promise<void> {
    if (!this.tree.visible) return Promise.resolve();
    this.#restoring ??= this.#restore().finally(() => {
      this.#restoring = undefined;
    });
    return this.#restoring;
  }

  async #restore(): Promise<void> {
    const path = this.state.get<string[]>(this.#key);
    if (!Array.isArray(path) || path.length !== 3 || path.some(id => typeof id !== 'string'))
      return;
    const generation = this.#generation;
    const find = async (
      index: number,
      parent?: ReviewTreeElement,
    ): Promise<ReviewTreeElement | undefined> => {
      const children = await this.provider.getChildren(parent);
      if (generation !== this.#generation) return undefined;
      const item = children.find(child => this.provider.getTreeItem(child).id === path[index]);
      if (!item || index === path.length - 1) return item;
      return find(index + 1, item);
    };
    const item = await find(0);
    if (!(item instanceof MrItemModel) || generation !== this.#generation) return;
    await this.tree.reveal(item, { expand: true, select: true, focus: false });
    if (!this.#active || this.#active === item) await this.select(item);
  }

  #findMr(element: ReviewTreeElement | undefined): MrItemModel | undefined {
    let current = element;
    while (current) {
      if (current instanceof MrItemModel) return current;
      current = this.provider.getParent(current) ?? undefined;
    }
    return undefined;
  }

  #deactivate(): void {
    this.#generation += 1;
    this.#active = undefined;
    this.workspace.setSelectedReview(undefined);
  }

  #clearSelection(): void {
    this.#deactivate();
    Promise.resolve(this.state.update(this.#key, undefined)).catch(handleError);
  }
}
