import vscode from 'vscode';
import { InMemoryMemento } from '../../../test/integration/test_infrastructure/in_memory_memento';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { ViewedDecorationProvider } from '../review/viewed_decoration_provider';
import { viewedFilesStore } from '../review/viewed_files_store';
import { diffFile, mr, mrVersion } from '../test_utils/entities';
import { ChangedFileItem } from './items/changed_file_item';
import { setupViewedCheckboxes } from './viewed_checkbox_handler';

const MR_KEY = 'https://gitlab.com|9999|2000';

const flushPromises = () => new Promise(setImmediate);

describe('setupViewedCheckboxes', () => {
  let emitter: vscode.EventEmitter<vscode.TreeCheckboxChangeEvent<vscode.TreeItem>>;
  let decorationProvider: ViewedDecorationProvider;
  let item: ChangedFileItem;

  beforeEach(() => {
    viewedFilesStore.init(
      createFakePartial<vscode.ExtensionContext>({ globalState: new InMemoryMemento() }),
    );
    emitter = new vscode.EventEmitter();
    decorationProvider = new ViewedDecorationProvider();
    jest.spyOn(decorationProvider, 'fireChange');
    const treeView = createFakePartial<vscode.TreeView<vscode.TreeItem>>({
      onDidChangeCheckboxState: emitter.event,
    });
    setupViewedCheckboxes(treeView, decorationProvider);
    item = new ChangedFileItem(mr, mrVersion, diffFile, '/repo', () => false, MR_KEY);
  });

  it('marks the file as viewed when the checkbox is checked', async () => {
    emitter.fire({ items: [[item, vscode.TreeItemCheckboxState.Checked]] });
    await flushPromises();

    const { mrKey, fileId, contentHash } = item.viewedState;
    expect(viewedFilesStore.isViewed(mrKey, fileId, contentHash)).toBe(true);
    expect(decorationProvider.fireChange).toHaveBeenCalledWith(item.resourceUri);
  });

  it('marks the file as not viewed when the checkbox is unchecked', async () => {
    const { mrKey, fileId, contentHash } = item.viewedState;
    await viewedFilesStore.setViewed(mrKey, fileId, contentHash);

    emitter.fire({ items: [[item, vscode.TreeItemCheckboxState.Unchecked]] });
    await flushPromises();

    expect(viewedFilesStore.isViewed(mrKey, fileId, contentHash)).toBe(false);
    expect(decorationProvider.fireChange).toHaveBeenCalledWith(item.resourceUri);
  });

  it('ignores tree items that are not changed files', async () => {
    const otherItem = new vscode.TreeItem('Overview');

    emitter.fire({ items: [[otherItem, vscode.TreeItemCheckboxState.Checked]] });
    await flushPromises();

    expect(decorationProvider.fireChange).not.toHaveBeenCalled();
  });
});
