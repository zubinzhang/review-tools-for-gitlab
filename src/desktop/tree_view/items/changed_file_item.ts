import { posix as path } from 'path';
import * as vscode from 'vscode';
import { isEmptyFileUri, toReviewUri } from '../../review/review_uri';
import { VS_COMMANDS } from '../../../common/command_names';
import {
  HAS_COMMENTS_QUERY_KEY,
  VIEWED_MR_KEY_QUERY_KEY,
  VIEWED_FILE_ID_QUERY_KEY,
  VIEWED_HASH_QUERY_KEY,
} from '../../constants';
import { getFileContentHash, viewedFilesStore } from '../../review/viewed_files_store';
import { DiffFileItem, getChangeType } from './diff_file_item';

export { getChangeType } from './diff_file_item';

export type HasCommentsFn = (reviewUri: vscode.Uri) => boolean;

// All extensions supported by VS Code's built-in Media Previewer.
// https://github.com/microsoft/vscode/blob/ba38f8a5eeb81c05dbdade3e1657e233d770f717/extensions/media-preview/package.json
const mediaExtensions = [
  '.jpg',
  '.jpe',
  '.jpeg',
  '.png',
  '.bmp',
  '.gif',
  '.ico',
  '.webp',
  '.avif',
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.mp4',
  '.webm',
];
const looksLikeMedia = (filePath: string) =>
  mediaExtensions.includes(path.extname(filePath).toLowerCase());

export const getBaseAndHeadUri = (
  mr: Pick<RestMr, 'id' | 'project_id'>,
  mrVersion: RestMrVersion,
  file: RestDiffFile,
  repositoryPath: string,
) => {
  const commonParams = {
    repositoryRoot: repositoryPath,
    changeType: getChangeType(file),
    projectId: mr.project_id,
    mrId: mr.id,
  };
  const baseFileUri = toReviewUri({
    ...commonParams,
    path: file.old_path,
    exists: !file.new_file,
    commit: mrVersion.base_commit_sha,
    side: 'base',
  });
  const headFileUri = toReviewUri({
    ...commonParams,
    path: file.new_path,
    exists: !file.deleted_file,
    commit: mrVersion.head_commit_sha,
    side: 'head',
  });
  return { baseFileUri, headFileUri };
};

export class ChangedFileItem extends DiffFileItem {
  headFileUri: vscode.Uri;

  baseFileUri: vscode.Uri;

  readonly viewedState: { mrKey: string; fileId: string; contentHash: string };

  constructor(
    mr: RestMr,
    mrVersion: RestMrVersion,
    file: RestDiffFile,
    repositoryPath: string,
    hasComment: HasCommentsFn,
    mrKey: string,
    shownInList = true,
  ) {
    super(file, shownInList);
    this.contextValue = 'changed-file-item';
    const uris = getBaseAndHeadUri(mr, mrVersion, file, repositoryPath);
    this.headFileUri = uris.headFileUri;
    this.baseFileUri = uris.baseFileUri;
    const headIsEmpty = isEmptyFileUri(uris.headFileUri);
    const baseIsEmpty = isEmptyFileUri(uris.baseFileUri);
    const hasComments = hasComment(this.baseFileUri) || hasComment(this.headFileUri);
    this.viewedState = {
      mrKey,
      fileId: file.new_path,
      contentHash: getFileContentHash(file),
    };
    this.checkboxState = viewedFilesStore.isViewed(
      this.viewedState.mrKey,
      this.viewedState.fileId,
      this.viewedState.contentHash,
    )
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    const query = new URLSearchParams([
      ...new URLSearchParams(this.resourceUri?.query),
      [HAS_COMMENTS_QUERY_KEY, String(hasComments)],
      [VIEWED_MR_KEY_QUERY_KEY, this.viewedState.mrKey],
      [VIEWED_FILE_ID_QUERY_KEY, this.viewedState.fileId],
      [VIEWED_HASH_QUERY_KEY, this.viewedState.contentHash],
    ]).toString();
    this.resourceUri = this.resourceUri?.with({ query });

    if (looksLikeMedia(uris.headFileUri.path) && (headIsEmpty || baseIsEmpty)) {
      this.command = {
        title: 'Show changes',
        command: VS_COMMANDS.OPEN,
        arguments: [headIsEmpty ? this.baseFileUri : this.headFileUri],
      };
    } else {
      this.command = {
        title: 'Show changes',
        command: VS_COMMANDS.DIFF,
        arguments: [
          this.baseFileUri,
          this.headFileUri,
          `${path.basename(file.new_path)} (!${mr.iid})`,
        ],
      };
    }
  }
}
