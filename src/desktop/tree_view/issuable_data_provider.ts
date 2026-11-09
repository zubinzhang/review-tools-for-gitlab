import * as vscode from 'vscode';
import { ExtensionState } from '../extension_state';
import { gitExtensionWrapper } from '../git/git_extension_wrapper';
import { GitRepository } from '../git/new_git';
import { getProjectRepository } from '../gitlab/gitlab_project_repository';
import { extensionConfigurationService } from '../../common/utils/extension_configuration_service';
import { canonicalReviewPath } from '../review/review_worktree';
import { onSidebarViewStateChange } from './sidebar_view_state';
import { ItemModel } from './items/item_model';
import { MultipleProjectsItem } from './items/multiple_projects_item';
import { NoProjectItem } from './items/no_project_item';
import { ProjectItemModel } from './items/project_item_model';
import { ChangedFolderItem } from './items/changed_folder_item';
import { reviewProjectId } from './review_tree_id';
import { MrItemModel } from './items/mr_item_model';

export type ReviewTreeElement = ItemModel | vscode.TreeItem;

export class IssuableDataProvider implements vscode.TreeDataProvider<ItemModel | vscode.TreeItem> {
  #eventEmitter = new vscode.EventEmitter<ReviewTreeElement | undefined>();

  #watchedMrs = new WeakSet<MrItemModel>();

  #mrSubscriptions: vscode.Disposable[] = [];

  #children: ItemModel[] = [];

  #roots: ReviewTreeElement[] = [];

  #signature?: string;

  #parents = new WeakMap<ReviewTreeElement, ReviewTreeElement>();

  #extensionState: ExtensionState;

  onDidChangeTreeData = this.#eventEmitter.event;

  // FIXME: we should add all the dependencies in the constructor (avoid using singletons)
  constructor(
    extensionState: ExtensionState,
    private readonly includeRepository: (repository: GitRepository) => boolean = () => true,
  ) {
    this.#extensionState = extensionState;
    this.#extensionState.onDidChangeValid(this.refresh, this);
    getProjectRepository().onProjectChange(this.#refreshIfChanged, this);
    extensionConfigurationService.onChange(this.#refreshIfChanged, this);
    onSidebarViewStateChange(this.refresh, this);
  }

  async getChildren(el: ReviewTreeElement | undefined): Promise<ReviewTreeElement[]> {
    if (el) {
      if (el instanceof MrItemModel && !this.#watchedMrs.has(el)) {
        this.#watchedMrs.add(el);
        this.#mrSubscriptions.push(el.onDidChange(() => this.#eventEmitter.fire(el)));
      }
      const children =
        el instanceof ItemModel || el instanceof ChangedFolderItem ? await el.getChildren() : [];
      children.forEach(child => this.#parents.set(child, el));
      return children;
    }
    if (!this.#extensionState.isValid()) {
      this.#children.forEach(child => child.dispose());
      this.#children = [];
      this.#roots = [];
      this.#signature = undefined;
      this.#clearMrSubscriptions();
      return [];
    }
    const { descriptors, customQueries, signature } = this.#describe();
    if (signature === this.#signature) return this.#roots;
    this.#children.forEach(child => child.dispose());
    this.#clearMrSubscriptions();
    this.#parents = new WeakMap();
    const children = descriptors.map(({ repository, selected, ambiguous }) => {
      if (selected) return new ProjectItemModel(selected, customQueries, descriptors.length === 1);
      const item = ambiguous ? new MultipleProjectsItem(repository) : new NoProjectItem(repository);
      item.id = `review-repository:${canonicalReviewPath(repository.rootFsPath)}`;
      return item;
    });
    this.#children = children.filter(
      (child): child is ProjectItemModel => child instanceof ProjectItemModel,
    );
    this.#roots = children;
    this.#signature = signature;
    return children;
  }

  #describe() {
    const { customQueries } = extensionConfigurationService.getConfiguration();
    const seen = new Set<string>();
    const repositories = gitExtensionWrapper.gitRepositories
      .filter(this.includeRepository)
      .filter(repository => {
        const root = canonicalReviewPath(repository.rootFsPath);
        if (seen.has(root)) return false;
        seen.add(root);
        return true;
      });
    const descriptors = repositories.map(repository => {
      const selected = getProjectRepository().getSelectedOrDefaultForRepository(
        repository.rootFsPath,
      );
      return {
        repository,
        selected,
        ambiguous:
          !selected && getProjectRepository().repositoryHasAmbiguousProjects(repository.rootFsPath),
      };
    });
    const signature = JSON.stringify([
      customQueries,
      descriptors.map(({ repository, selected, ambiguous }) =>
        selected
          ? [reviewProjectId(selected), selected.project, selected.initializationType]
          : [canonicalReviewPath(repository.rootFsPath), ambiguous],
      ),
    ]);
    return { descriptors, customQueries, signature };
  }

  getParent(item?: ReviewTreeElement): ReviewTreeElement | null {
    return item ? (this.#parents.get(item) ?? null) : null;
  }

  getElementPath(item: ReviewTreeElement): string[] | undefined {
    const ids: string[] = [];
    let current: ReviewTreeElement | null = item;
    while (current) {
      const { id } = this.getTreeItem(current);
      if (!id) return undefined;
      ids.unshift(id);
      current = this.getParent(current);
    }
    return ids;
  }

  getTreeItem(item: vscode.TreeItem | ItemModel) {
    if (item instanceof ItemModel) return item.getTreeItem();
    return item;
  }

  refresh(): void {
    this.#signature = undefined;
    this.#eventEmitter.fire(undefined);
  }

  #clearMrSubscriptions(): void {
    this.#mrSubscriptions.forEach(subscription => subscription.dispose());
    this.#mrSubscriptions = [];
    this.#watchedMrs = new WeakSet();
  }

  #refreshIfChanged = (): void => {
    if (this.#describe().signature !== this.#signature) this.refresh();
  };
}
