import * as vscode from 'vscode';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { InMemoryMemento } from '../../../test/integration/test_infrastructure/in_memory_memento';
import { mr, projectInRepository } from '../test_utils/entities';
import { IssuableDataProvider, ReviewTreeElement } from '../tree_view/issuable_data_provider';
import { MrItemModel } from '../tree_view/items/mr_item_model';
import { ReviewNavigation } from './review_navigation';
import { ReviewWorkspace } from './review_workspace';
import { ReviewTreeController } from './review_tree_controller';

describe('ReviewTreeController', () => {
  let tree: vscode.TreeView<ReviewTreeElement>;
  let provider: IssuableDataProvider;
  let navigation: ReviewNavigation;
  let workspace: ReviewWorkspace;
  let state: vscode.Memento;
  let first: MrItemModel;
  let second: MrItemModel;
  let controller: ReviewTreeController;
  const commit = 'a'.repeat(40);
  const root = new vscode.TreeItem('project');
  root.id = 'project';
  const query = new vscode.TreeItem('query');
  query.id = 'query';

  beforeEach(() => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      configurable: true,
      value: [{ uri: vscode.Uri.file('/original'), name: 'original', index: 0 }],
    });
    first = new MrItemModel(mr, projectInRepository, 'query');
    second = new MrItemModel(
      { ...mr, id: mr.id + 1, iid: mr.iid + 1 },
      projectInRepository,
      'query',
    );
    jest
      .spyOn(first, 'getReviewVersion')
      .mockResolvedValue(createFakePartial<RestMrVersion>({ head_commit_sha: commit }));
    jest
      .spyOn(second, 'getReviewVersion')
      .mockResolvedValue(createFakePartial<RestMrVersion>({ head_commit_sha: commit }));
    tree = createFakePartial<vscode.TreeView<ReviewTreeElement>>({
      visible: true,
      reveal: jest.fn().mockResolvedValue(undefined),
    });
    provider = createFakePartial<IssuableDataProvider>({
      getElementPath: jest.fn(item => [
        'project',
        'query',
        (item instanceof vscode.TreeItem ? item : item.getTreeItem()).id!,
      ]),
      getChildren: jest.fn(async item => {
        if (!item) return [root];
        if (item === root) return [query];
        return [first, second];
      }),
      getTreeItem: item => (item instanceof vscode.TreeItem ? item : item.getTreeItem()),
    });
    navigation = createFakePartial<ReviewNavigation>({
      prepareReview: jest.fn().mockResolvedValue(undefined),
    });
    workspace = createFakePartial<ReviewWorkspace>({ setSelectedReview: jest.fn() });
    state = new InMemoryMemento();
    controller = new ReviewTreeController(tree, provider, navigation, workspace, state);
  });

  it('prepares the clicked MR at its diff head and shares simultaneous selection/expansion requests', async () => {
    await Promise.all([controller.select(first), controller.select(first)]);
    expect(first.getReviewVersion).toHaveBeenCalledTimes(1);
    const expected = {
      repositoryRoot: projectInRepository.pointer.repository.rootFsPath,
      projectId: mr.project_id,
      mrId: mr.id,
      mrIid: mr.iid,
      commit,
      remoteName: projectInRepository.pointer.remote.name,
    };
    expect(navigation.prepareReview).toHaveBeenCalledTimes(1);
    expect(navigation.prepareReview).toHaveBeenCalledWith(expected);
    expect(workspace.setSelectedReview).toHaveBeenLastCalledWith(expected);
  });

  it('restores the selected MR after a host restart rather than choosing the first MR', async () => {
    await controller.select(second);
    controller = new ReviewTreeController(tree, provider, navigation, workspace, state);
    await controller.restore();
    expect(tree.reveal).toHaveBeenCalledWith(second, { expand: true, select: true, focus: false });
    expect(navigation.prepareReview).toHaveBeenLastCalledWith(
      expect.objectContaining({ mrId: second.mr.id }),
    );
  });

  it('ignores an older MR version request after the user selects another MR', async () => {
    let resolve: (version: RestMrVersion) => void;
    jest.mocked(first.getReviewVersion).mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const older = controller.select(first);
    await controller.select(second);
    resolve!(createFakePartial<RestMrVersion>({ head_commit_sha: commit }));
    await older;
    expect(navigation.prepareReview).toHaveBeenCalledTimes(1);
    expect(navigation.prepareReview).toHaveBeenCalledWith(
      expect.objectContaining({ mrId: second.mr.id }),
    );
  });

  it('does not reveal a stale selection or overwrite a newer selection while restoring', async () => {
    await controller.select(first);
    controller = new ReviewTreeController(tree, provider, navigation, workspace, state);
    let resolve: (items: ReviewTreeElement[]) => void;
    jest.mocked(provider.getChildren).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const restoring = controller.restore();
    await controller.select(second);
    resolve!([root]);
    await restoring;
    expect(tree.reveal).not.toHaveBeenCalled();
  });

  it('does not automatically fetch a version or create a worktree in an untrusted workspace', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: false });
    await controller.select(first);
    expect(first.getReviewVersion).not.toHaveBeenCalled();
    expect(navigation.prepareReview).not.toHaveBeenCalled();
  });

  it('does not open a hidden review sidebar just to restore a prior selection', async () => {
    await controller.select(first);
    Object.defineProperty(tree, 'visible', { value: false });
    await new ReviewTreeController(tree, provider, navigation, workspace, state).restore();
    expect(tree.reveal).not.toHaveBeenCalled();
  });

  it('releases the selected MR when the user selects a project or query row', async () => {
    await controller.select(first);
    let selection: (event: vscode.TreeViewSelectionChangeEvent<ReviewTreeElement>) => void;
    tree = createFakePartial<vscode.TreeView<ReviewTreeElement>>({
      visible: true,
      reveal: jest.fn(),
      onDidChangeSelection: callback => {
        selection = callback;
        return new vscode.Disposable(() => {});
      },
      onDidExpandElement: () => new vscode.Disposable(() => {}),
      onDidCollapseElement: () => new vscode.Disposable(() => {}),
      onDidChangeVisibility: () => new vscode.Disposable(() => {}),
    });
    provider.getParent = () => null;
    const listening = new ReviewTreeController(tree, provider, navigation, workspace, state);
    const listener = listening.listen();
    selection!({ selection: [new vscode.TreeItem('project')] });
    expect(workspace.setSelectedReview).toHaveBeenLastCalledWith(undefined);
    await listening.restore();
    expect(tree.reveal).not.toHaveBeenCalled();
    listener.dispose();
  });
});
