import * as vscode from 'vscode';
import { ViewedDecorationProvider } from '../review/viewed_decoration_provider';
import { viewedFilesStore } from '../review/viewed_files_store';
import { ChangedFileItem } from './items/changed_file_item';

export const setupViewedCheckboxes = <T>(
  treeView: vscode.TreeView<T>,
  decorationProvider: ViewedDecorationProvider,
): vscode.Disposable =>
  treeView.onDidChangeCheckboxState(async e => {
    // sequential on purpose: each update is a read-modify-write of the same globalState key
    for (const [item, state] of e.items) {
      if (item instanceof ChangedFileItem) {
        const { mrKey, fileId, contentHash } = item.viewedState;
        if (state === vscode.TreeItemCheckboxState.Checked) {
          // eslint-disable-next-line no-await-in-loop
          await viewedFilesStore.setViewed(mrKey, fileId, contentHash);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await viewedFilesStore.setNotViewed(mrKey, fileId);
        }
        if (item.resourceUri) decorationProvider.fireChange(item.resourceUri);
      }
    }
  });
