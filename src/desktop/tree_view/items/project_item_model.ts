import * as path from 'path';
import * as vscode from 'vscode';
import { CustomQuery } from '../../../common/gitlab/custom_query';
import { ProjectInRepository } from '../../gitlab/new_project';
import { reviewProjectId } from '../review_tree_id';
import { CustomQueryItemModel } from './custom_query_item_model';
import { ItemModel } from './item_model';

export class ProjectItemModel extends ItemModel {
  readonly projectInRepository: ProjectInRepository;

  #customQueries: CustomQuery[];

  #startExpanded: boolean;

  #queries?: CustomQueryItemModel[];

  constructor(
    projectInRepository: ProjectInRepository,
    customQueries: CustomQuery[],
    startExpanded = false,
  ) {
    super();
    this.projectInRepository = projectInRepository;
    this.#customQueries = customQueries;
    this.#startExpanded = startExpanded;
  }

  getTreeItem(): vscode.TreeItem {
    const label =
      this.projectInRepository.initializationType === 'selected'
        ? `${this.projectInRepository.project.name} (using ${this.projectInRepository.pointer.remote.name} remote)`
        : this.projectInRepository.project.name;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = reviewProjectId(this.projectInRepository);
    item.iconPath = new vscode.ThemeIcon('project');
    item.contextValue =
      this.projectInRepository.initializationType === 'selected' ? 'selected-project' : '';
    const { Expanded, Collapsed } = vscode.TreeItemCollapsibleState;
    item.collapsibleState = this.#startExpanded ? Expanded : Collapsed;
    const projectFolderPath =
      this.projectInRepository.pointer.repository.rawRepository.rootUri.path;
    item.description = path.basename(projectFolderPath);
    item.tooltip = projectFolderPath;
    return item;
  }

  async getChildren(): Promise<ItemModel[]> {
    this.#queries ??= this.#customQueries.map(
      (query, index) =>
        new CustomQueryItemModel(
          query,
          this.projectInRepository,
          `${reviewProjectId(this.projectInRepository)}/query/${index}:${JSON.stringify(query)}`,
        ),
    );
    this.setDisposableChildren(this.#queries);
    return this.#queries;
  }
}
