import * as vscode from 'vscode';
import { customQuery, projectInRepository } from '../../test_utils/entities';
import { ProjectInRepository } from '../../gitlab/new_project';
import { createFakePartial } from '../../../common/test_utils/create_fake_partial';
import { CustomQueryItemModel } from './custom_query_item_model';
import { ProjectItemModel } from './project_item_model';

describe('RepositoryItemModel', () => {
  let item: ProjectItemModel;
  let selectedProjectInRepository: ProjectInRepository;
  let nonSelectedProjectInRepository: ProjectInRepository;

  beforeEach(() => {
    item = new ProjectItemModel(projectInRepository, [customQuery]);

    selectedProjectInRepository = createFakePartial<ProjectInRepository>({
      ...projectInRepository,
      initializationType: 'selected',
      pointer: {
        ...projectInRepository.pointer,
        remote: { name: 'upstream' },
      },
    });

    nonSelectedProjectInRepository = createFakePartial<ProjectInRepository>({
      ...projectInRepository,
      initializationType: undefined,
    });
  });

  it('should use project name to create collapsed item', async () => {
    const treeItem = await item.getTreeItem();
    expect(treeItem.label).toBe('gitlab-vscode-extension');
    expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  });

  it('should return custom query children', async () => {
    const [a] = await item.getChildren();
    expect(a).toBeInstanceOf(CustomQueryItemModel);
    expect(await a.getTreeItem().label).toBe(customQuery.name);
  });

  it('provides stable distinct IDs for project and query branches across reloads', async () => {
    const other = new ProjectItemModel(projectInRepository, [customQuery, customQuery]);
    expect(item.getTreeItem().id).toBeTruthy();
    expect(other.getTreeItem().id).toBe(item.getTreeItem().id);
    const queries = await other.getChildren();
    expect(queries[0].getTreeItem().id).toBeTruthy();
    expect(queries[1].getTreeItem().id).not.toBe(queries[0].getTreeItem().id);
  });

  it('reuses query objects so revealing an MR can resolve its loaded ancestors', async () => {
    const first = await item.getChildren();
    expect((await item.getChildren())[0]).toBe(first[0]);
  });

  describe('item labeled as a project', () => {
    it('should have project name as a label for non-selected projects', () => {
      const itemModel = new ProjectItemModel(nonSelectedProjectInRepository, [customQuery]);
      expect(itemModel.getTreeItem().label).toBe(nonSelectedProjectInRepository.project.name);
    });

    it('should have project name with remote info as label for selected projects', () => {
      const itemModel = new ProjectItemModel(selectedProjectInRepository, [customQuery]);
      const expectedLabel = `${selectedProjectInRepository.project.name} (using ${selectedProjectInRepository.pointer.remote.name} remote)`;
      expect(itemModel.getTreeItem().label).toBe(expectedLabel);
    });

    it('should have project icon', () => {
      expect(item.getTreeItem().iconPath).toEqual(new vscode.ThemeIcon('project'));
    });

    it('should have project/worktree folder name as a description', () => {
      const folderPath = projectInRepository.pointer.repository.rawRepository.rootUri.path;
      expect(item.getTreeItem().description).toBe(folderPath.split('/').pop());
    });

    it('should have project folder as a tooltip', () => {
      expect(item.getTreeItem().tooltip).toBe(
        projectInRepository.pointer.repository.rawRepository.rootUri.path,
      );
    });

    it('should have selected-project context value for selected projects', () => {
      const itemModel = new ProjectItemModel(selectedProjectInRepository, [customQuery]);
      expect(itemModel.getTreeItem().contextValue).toBe('selected-project');
    });

    it('should have empty context value for non-selected projects', () => {
      const itemModel = new ProjectItemModel(nonSelectedProjectInRepository, [customQuery]);
      expect(itemModel.getTreeItem().contextValue).toBe('');
    });
  });
});
