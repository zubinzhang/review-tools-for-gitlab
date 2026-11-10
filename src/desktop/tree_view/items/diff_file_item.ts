import { posix as path } from 'path';
import * as vscode from 'vscode';
import { ADDED, DELETED, RENAMED, MODIFIED, CHANGE_TYPE_QUERY_KEY } from '../../constants';
import { ChangeType } from '../../review/review_uri';

export const getChangeType = (file: RestDiffFile): ChangeType => {
  if (file.new_file) return ADDED;
  if (file.deleted_file) return DELETED;
  if (file.renamed_file) return RENAMED;
  return MODIFIED;
};

export class DiffFileItem extends vscode.TreeItem {
  constructor(file: RestDiffFile, shownInList = true) {
    const filePath = file.new_path || file.old_path;
    super(vscode.Uri.file(filePath));
    this.label = path.basename(filePath);
    if (shownInList) {
      this.description = path.dirname(`/${filePath}`).split('/').slice(1).join('/');
    }
    this.resourceUri = this.resourceUri?.with({
      query: new URLSearchParams([[CHANGE_TYPE_QUERY_KEY, getChangeType(file)]]).toString(),
    });
  }
}
