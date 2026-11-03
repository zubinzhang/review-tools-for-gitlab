import * as vscode from 'vscode';
import {
  VIEWED_MR_KEY_QUERY_KEY,
  VIEWED_FILE_ID_QUERY_KEY,
  VIEWED_HASH_QUERY_KEY,
} from '../constants';
import { viewedFilesStore } from './viewed_files_store';

export class ViewedDecorationProvider implements vscode.FileDecorationProvider {
  #emitter = new vscode.EventEmitter<vscode.Uri>();

  onDidChangeFileDecorations = this.#emitter.event;

  fireChange(uri: vscode.Uri): void {
    this.#emitter.fire(uri);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') return undefined;
    const params = new URLSearchParams(uri.query);
    const mrKey = params.get(VIEWED_MR_KEY_QUERY_KEY);
    const fileId = params.get(VIEWED_FILE_ID_QUERY_KEY);
    const contentHash = params.get(VIEWED_HASH_QUERY_KEY);
    if (!mrKey || !fileId || !contentHash) return undefined;
    if (!viewedFilesStore.isViewed(mrKey, fileId, contentHash)) return undefined;
    return {
      color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
      tooltip: 'Viewed',
    };
  }
}

export const viewedDecorationProvider = new ViewedDecorationProvider();
