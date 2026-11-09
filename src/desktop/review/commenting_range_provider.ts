import * as vscode from 'vscode';
import { REVIEW_URI_SCHEME } from '../constants';
import { getAddedLinesForFile } from '../git/diff_line_count';
import { findFileInDiffs } from '../utils/find_file_in_diffs';
import { fromReviewUri } from './review_uri';

const lastLineEmpty = (document: vscode.TextDocument): boolean => {
  const lastLIne = document.lineAt(document.lineCount - 1);
  return lastLIne.isEmptyOrWhitespace;
};
export class CommentingRangeProvider implements vscode.CommentingRangeProvider {
  #mr: RestMr;

  #mrVersion: RestMrVersion;

  constructor(mr: RestMr, mrVersion: RestMrVersion) {
    this.#mr = mr;
    this.#mrVersion = mrVersion;
  }

  provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] {
    const { uri } = document;
    if (uri.scheme !== REVIEW_URI_SCHEME) return [];
    const params = fromReviewUri(uri);
    if (
      params.comparison === 'commit' ||
      params.mrId !== this.#mr.id ||
      params.projectId !== this.#mr.project_id ||
      !params.path ||
      !params.exists
    ) {
      return [];
    }
    const oldFile = params.commit === this.#mrVersion.base_commit_sha;
    if (
      (!oldFile && params.commit !== this.#mrVersion.head_commit_sha) ||
      (params.side === 'head' && oldFile) ||
      (params.side === 'base' && !oldFile)
    )
      return [];
    const diff = findFileInDiffs(
      this.#mrVersion.diffs,
      oldFile ? { oldPath: params.path } : { newPath: params.path },
    );
    if (!diff?.diff) return [];
    if (oldFile) {
      const endOfRange = lastLineEmpty(document) ? document.lineCount - 2 : document.lineCount - 1;
      if (endOfRange < 0) return [];
      return [new vscode.Range(new vscode.Position(0, 0), new vscode.Position(endOfRange, 0))];
    }
    const result = getAddedLinesForFile(this.#mrVersion, params.path);
    return result.map(
      l => new vscode.Range(new vscode.Position(l - 1, 0), new vscode.Position(l - 1, 0)),
    );
  }
}
