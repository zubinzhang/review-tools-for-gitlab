import assert from 'assert';
import crypto from 'crypto';
import { ExtensionContext } from 'vscode';

const VIEWED_MR_FILES_KEY = 'viewedMrFiles';
const MAX_STORED_MRS = 100;

interface ViewedMrEntry {
  updatedAt: number;
  /** file id (new_path) -> content hash at the time the file was marked as viewed */
  files: Record<string, string>;
}

type ViewedMrFiles = Record<string, ViewedMrEntry>;

export const getMrKey = (instanceUrl: string, projectId: number, mrId: number): string =>
  `${instanceUrl}|${projectId}|${mrId}`;

/**
 * The REST diff API doesn't expose per-file blob ids, so we hash the paths and
 * the diff text instead. When a new push changes the file, the hash changes and
 * the stored "viewed" state no longer applies (same reset behavior as the GitLab web UI).
 */
export const getFileContentHash = (file: RestDiffFile): string =>
  crypto
    .createHash('sha1')
    .update(`${file.old_path}\0${file.new_path}\0${file.diff}`)
    .digest('hex');

const keepMostRecentMrs = (state: ViewedMrFiles): ViewedMrFiles => {
  const entries = Object.entries(state);
  if (entries.length <= MAX_STORED_MRS) return state;
  return Object.fromEntries(
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED_MRS),
  );
};

export interface ViewedFilesStore {
  init(context: ExtensionContext): void;
  isViewed(mrKey: string, fileId: string, currentHash: string): boolean;
  setViewed(mrKey: string, fileId: string, contentHash: string): Promise<void>;
  setNotViewed(mrKey: string, fileId: string): Promise<void>;
}

export class ViewedFilesStoreImpl implements ViewedFilesStore {
  #context: ExtensionContext | undefined;

  init(context: ExtensionContext): void {
    this.#context = context;
  }

  isViewed(mrKey: string, fileId: string, currentHash: string): boolean {
    return this.#getState()[mrKey]?.files[fileId] === currentHash;
  }

  async setViewed(mrKey: string, fileId: string, contentHash: string): Promise<void> {
    const state = this.#getState();
    const entry = state[mrKey] ?? { updatedAt: 0, files: {} };
    await this.#setState({
      ...state,
      [mrKey]: {
        updatedAt: Date.now(),
        files: { ...entry.files, [fileId]: contentHash },
      },
    });
  }

  async setNotViewed(mrKey: string, fileId: string): Promise<void> {
    const state = this.#getState();
    const entry = state[mrKey];
    if (!entry) return;
    const files = Object.fromEntries(
      Object.entries(entry.files).filter(([viewedFileId]) => viewedFileId !== fileId),
    );
    if (Object.keys(files).length === 0) {
      await this.#setState(
        Object.fromEntries(Object.entries(state).filter(([key]) => key !== mrKey)),
      );
      return;
    }
    await this.#setState({ ...state, [mrKey]: { updatedAt: Date.now(), files } });
  }

  #getState(): ViewedMrFiles {
    assert(this.#context);
    return this.#context.globalState.get(VIEWED_MR_FILES_KEY) || {};
  }

  async #setState(state: ViewedMrFiles): Promise<void> {
    assert(this.#context);
    await this.#context.globalState.update(VIEWED_MR_FILES_KEY, keepMostRecentMrs(state));
  }
}

export const viewedFilesStore: ViewedFilesStore = new ViewedFilesStoreImpl();
