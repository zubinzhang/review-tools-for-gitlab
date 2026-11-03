import vscode from 'vscode';
import { InMemoryMemento } from '../../../../test/integration/test_infrastructure/in_memory_memento';
import { VS_COMMANDS } from '../../../common/command_names';
import { createFakePartial } from '../../../common/test_utils/create_fake_partial';
import {
  ADDED,
  CHANGE_TYPE_QUERY_KEY,
  DELETED,
  HAS_COMMENTS_QUERY_KEY,
  MODIFIED,
  RENAMED,
  VIEWED_FILE_ID_QUERY_KEY,
  VIEWED_HASH_QUERY_KEY,
  VIEWED_MR_KEY_QUERY_KEY,
} from '../../constants';
import { toReviewUri } from '../../review/review_uri';
import { getFileContentHash, viewedFilesStore } from '../../review/viewed_files_store';
import { diffFile, mr, mrVersion } from '../../test_utils/entities';
import { ChangedFileItem } from './changed_file_item';

const mrKey = 'https://gitlab.com|9999|2000';

describe('ChangedFileItem', () => {
  beforeEach(() => {
    viewedFilesStore.init(
      createFakePartial<vscode.ExtensionContext>({ globalState: new InMemoryMemento() }),
    );
  });

  describe('image file', () => {
    const extensions = ['.jpg', '.png', '.mp3', '.webm'];

    it.each(extensions)('should show diff for changed %s file', extension => {
      const changedImageFile = { ...diffFile, new_path: `file${extension}` };
      const item = new ChangedFileItem(
        mr,
        mrVersion,
        changedImageFile,
        '/repo',
        () => false,
        mrKey,
      );

      expect(item.command?.command).toBe(VS_COMMANDS.DIFF);
    });

    it.each(extensions)('should not show diff for new %s file', extension => {
      const path = `newfile${extension}`;
      const changedImageFile = {
        ...diffFile,
        renamed_file: false,
        new_file: true,
        old_path: `invalid${extension}`,
        new_path: path,
      };
      const item = new ChangedFileItem(
        mr,
        mrVersion,
        changedImageFile,
        '/repo',
        () => false,
        mrKey,
      );

      expect(item.command?.command).toBe(VS_COMMANDS.OPEN);

      const [url] = item.command?.arguments ?? [];
      expect(url.path).toBe(path);
    });

    it.each(extensions)('should not show diff for deleted %s file', extension => {
      const path = `deleted${extension}`;
      const changedImageFile = {
        ...diffFile,
        renamed_file: false,
        deleted_file: true,
        old_path: path,
        new_path: `invalid${extension}`,
      };
      const item = new ChangedFileItem(
        mr,
        mrVersion,
        changedImageFile,
        '/repo',
        () => false,
        mrKey,
      );

      expect(item.command?.command).toBe(VS_COMMANDS.OPEN);

      const [url] = item.command?.arguments ?? [];
      expect(url.path).toBe(path);
    });

    it.each`
      file                                                                          | changeType
      ${{ ...diffFile, new_file: true, deleted_file: false, renamed_file: false }}  | ${ADDED}
      ${{ ...diffFile, new_file: false, deleted_file: true, renamed_file: false }}  | ${DELETED}
      ${{ ...diffFile, new_file: false, deleted_file: false, renamed_file: true }}  | ${RENAMED}
      ${{ ...diffFile, new_file: false, deleted_file: false, renamed_file: false }} | ${MODIFIED}
    `('indicates change type $changeType', ({ file, changeType }) => {
      const item = new ChangedFileItem(mr, mrVersion, file, '/repo', () => false, mrKey);

      expect(item.resourceUri?.query).toContain(`${CHANGE_TYPE_QUERY_KEY}=${changeType}`);
    });
  });

  describe('captures whether there are comments on the changes', () => {
    let areThereChanges: boolean;

    const createItem = () =>
      new ChangedFileItem(
        mr,
        mrVersion,
        diffFile,
        '/repository/fsPath',
        () => areThereChanges,
        mrKey,
      );

    it('indicates there are comments', () => {
      areThereChanges = true;
      expect(createItem().resourceUri?.query).toMatch(`${HAS_COMMENTS_QUERY_KEY}=true`);
    });

    it('indicates there are no comments', () => {
      areThereChanges = false;
      expect(createItem().resourceUri?.query).toMatch(`${HAS_COMMENTS_QUERY_KEY}=false`);
    });
  });

  describe('viewed state', () => {
    const createItem = () =>
      new ChangedFileItem(mr, mrVersion, diffFile, '/repository/fsPath', () => false, mrKey);

    it('adds viewed query params to the resourceUri', () => {
      const query = new URLSearchParams(createItem().resourceUri?.query);

      expect(query.get(VIEWED_MR_KEY_QUERY_KEY)).toBe(mrKey);
      expect(query.get(VIEWED_FILE_ID_QUERY_KEY)).toBe(diffFile.new_path);
      expect(query.get(VIEWED_HASH_QUERY_KEY)).toBe(getFileContentHash(diffFile));
    });

    it('exposes the viewed state used by the checkbox handler', () => {
      expect(createItem().viewedState).toEqual({
        mrKey,
        fileId: diffFile.new_path,
        contentHash: getFileContentHash(diffFile),
      });
    });

    it('starts with unchecked checkbox when the file is not viewed', () => {
      expect(createItem().checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    });

    it('starts with checked checkbox when the file is viewed', async () => {
      await viewedFilesStore.setViewed(mrKey, diffFile.new_path, getFileContentHash(diffFile));

      expect(createItem().checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    });

    it('starts with unchecked checkbox when the file changed since it was viewed', async () => {
      await viewedFilesStore.setViewed(mrKey, diffFile.new_path, 'stale-hash');

      expect(createItem().checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    });
  });

  describe('intialization', () => {
    it('sets context and head and base URIs', () => {
      const item = new ChangedFileItem(
        mr,
        mrVersion,
        diffFile,
        '/repository/fsPath',
        () => false,
        mrKey,
      );
      expect(item.baseFileUri).toEqual(
        toReviewUri({
          path: diffFile.old_path,
          exists: true,
          commit: mrVersion.base_commit_sha,
          side: 'base',
          repositoryRoot: '/repository/fsPath',
          projectId: mr.project_id,
          mrId: mr.id,
          changeType: RENAMED,
        }),
      );
      expect(item.headFileUri).toEqual(
        toReviewUri({
          path: diffFile.new_path,
          exists: true,
          commit: mrVersion.head_commit_sha,
          side: 'head',
          repositoryRoot: '/repository/fsPath',
          projectId: mr.project_id,
          mrId: mr.id,
          changeType: RENAMED,
        }),
      );
      expect(item.contextValue).toBe('changed-file-item');
    });
  });
});
