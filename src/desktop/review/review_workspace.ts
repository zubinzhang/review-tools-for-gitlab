import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { REVIEW_URI_SCHEME } from '../constants';
import { canonicalReviewPath, ReviewWorktreeRequest } from './review_worktree';
import { fromReviewUri } from './review_uri';

type Folder = Pick<vscode.WorkspaceFolder, 'uri' | 'name'>;

interface ActiveResources {
  reviews: Set<string>;
  physical: vscode.Uri[];
}

function contains(root: string, filename: string): boolean {
  const relative = path.relative(canonicalReviewPath(root), canonicalReviewPath(filename));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function identityKey(
  request: Pick<ReviewWorktreeRequest, 'repositoryRoot' | 'projectId' | 'mrId' | 'commit'>,
): string {
  return JSON.stringify([
    canonicalReviewPath(request.repositoryRoot),
    request.projectId,
    request.mrId,
    request.commit,
  ]);
}

export class ReviewWorkspace {
  #updates: Promise<boolean> = Promise.resolve(true);

  #timer?: ReturnType<typeof setTimeout>;

  #disposed = false;

  #selectedReview?: string;

  #scheduleCleanup?: () => void;

  constructor(
    private readonly storagePath: string,
    private readonly previousStoragePaths: readonly string[] = [],
  ) {}

  isReviewRoot(root: string): boolean {
    return [this.storagePath, ...this.previousStoragePaths].some(storage =>
      contains(storage, root),
    );
  }

  isIncluded(root: string): boolean {
    return Boolean(
      vscode.workspace.workspaceFolders?.some(
        folder => canonicalReviewPath(folder.uri.fsPath) === canonicalReviewPath(root),
      ),
    );
  }

  listen(): vscode.Disposable {
    const schedule = () => {
      clearTimeout(this.#timer);
      if (this.#disposed) return;
      this.#timer = setTimeout(() => {
        this.removeInactive().catch(() => {});
      }, 30000);
    };
    schedule();
    this.#scheduleCleanup = schedule;
    return vscode.Disposable.from(
      vscode.window.tabGroups.onDidChangeTabs(schedule),
      vscode.window.tabGroups.onDidChangeTabGroups(schedule),
      vscode.workspace.onDidChangeWorkspaceFolders(schedule),
      new vscode.Disposable(() => {
        this.#disposed = true;
        clearTimeout(this.#timer);
        this.#scheduleCleanup = undefined;
      }),
    );
  }

  setSelectedReview(request: ReviewWorktreeRequest | undefined): void {
    this.#selectedReview = request ? identityKey(request) : undefined;
    this.#scheduleCleanup?.();
  }

  deduplicate(): Promise<boolean> {
    return this.#enqueue(() => this.#apply(this.#unique(vscode.workspace.workspaceFolders ?? [])));
  }

  include(root: string, request: ReviewWorktreeRequest): Promise<boolean> {
    return this.#enqueue(async () => {
      const folders = [...(vscode.workspace.workspaceFolders ?? [])];
      if (!this.isIncluded(root))
        folders.push({
          uri: vscode.Uri.file(root),
          name: `Review !${request.mrIid} · ${request.commit.slice(0, 8)}`,
          index: folders.length,
        });
      return this.#apply(this.#unique(folders));
    });
  }

  removeInactive(): Promise<boolean> {
    return this.#enqueue(async () => {
      const folders = this.#unique(vscode.workspace.workspaceFolders ?? []);
      const resources = this.#activeResources();
      return this.#apply(folders.filter(folder => this.#isActive(folder.uri.fsPath, resources)));
    });
  }

  isActive(root: string): boolean {
    return this.#isActive(root, this.#activeResources());
  }

  detach(root: string): Promise<boolean> {
    return this.#enqueue(async () => {
      if (this.isActive(root)) return false;
      return this.#apply(
        (vscode.workspace.workspaceFolders ?? []).filter(
          folder => canonicalReviewPath(folder.uri.fsPath) !== canonicalReviewPath(root),
        ),
      );
    });
  }

  #isActive(root: string, resources: ActiveResources): boolean {
    const key = this.#snapshotKey(root);
    return (
      !key ||
      resources.reviews.has(key) ||
      resources.physical.some(uri => contains(root, uri.fsPath))
    );
  }

  #activeResources(): ActiveResources {
    const reviews = new Set<string>();
    if (this.#selectedReview) reviews.add(this.#selectedReview);
    const physical: vscode.Uri[] = [];
    for (const group of vscode.window.tabGroups?.all ?? []) {
      for (const tab of group.tabs) {
        const { input } = tab;
        let uris: vscode.Uri[] = [];
        if (input instanceof vscode.TabInputTextDiff) uris = [input.original, input.modified];
        else if (input instanceof vscode.TabInputText) uris = [input.uri];
        for (const uri of uris) {
          if (uri.scheme === 'file') physical.push(uri);
          else if (uri.scheme === REVIEW_URI_SCHEME) {
            try {
              const params = fromReviewUri(uri);
              if (params.side === 'head' && params.commit)
                reviews.add(identityKey({ ...params, commit: params.commit }));
            } catch {
              continue;
            }
          }
        }
      }
    }
    for (const document of vscode.workspace.textDocuments ?? [])
      if (document.isDirty && document.uri.scheme === 'file') physical.push(document.uri);
    return { reviews, physical };
  }

  #snapshotKey(root: string): string | undefined {
    if (!this.isReviewRoot(root)) return undefined;
    try {
      const request: ReviewWorktreeRequest = JSON.parse(
        fs.readFileSync(`${canonicalReviewPath(root)}.json`, 'utf8'),
      );
      if (
        !path.isAbsolute(request.repositoryRoot) ||
        !Number.isSafeInteger(request.projectId) ||
        request.projectId <= 0 ||
        !Number.isSafeInteger(request.mrId) ||
        request.mrId <= 0 ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request.commit)
      )
        return undefined;
      return identityKey(request);
    } catch {
      return undefined;
    }
  }

  #unique(folders: readonly Folder[]): Folder[] {
    const resources = this.#activeResources();
    const preferred = new Map<string, Folder>();
    for (const folder of folders) {
      const key = this.#snapshotKey(folder.uri.fsPath);
      if (key && (!preferred.has(key) || contains(this.storagePath, folder.uri.fsPath)))
        preferred.set(key, folder);
    }
    const seen = new Set<string>();
    return folders.filter(folder => {
      const key = this.#snapshotKey(folder.uri.fsPath);
      const physical = canonicalReviewPath(folder.uri.fsPath);
      const hasOpenSource = resources.physical.some(uri => contains(folder.uri.fsPath, uri.fsPath));
      if (
        this.isReviewRoot(folder.uri.fsPath) &&
        /^[a-f0-9]{24}-[a-f0-9]{12}$/.test(path.basename(folder.uri.fsPath)) &&
        !fs.existsSync(folder.uri.fsPath) &&
        !hasOpenSource
      )
        return false;
      if (seen.has(physical)) return false;
      if (key && preferred.get(key) !== folder && !hasOpenSource) return false;
      seen.add(physical);
      return true;
    });
  }

  #enqueue(operation: () => Promise<boolean>): Promise<boolean> {
    this.#updates = this.#updates
      .catch(() => false)
      .then(() => (this.#disposed ? false : operation()));
    return this.#updates;
  }

  async #apply(desired: readonly Folder[]): Promise<boolean> {
    const current = vscode.workspace.workspaceFolders ?? [];
    const start = current.findIndex(
      (folder, index) => folder.uri.toString() !== desired[index]?.uri.toString(),
    );
    const first = start < 0 ? current.length : start;
    if (first === current.length && desired.length === current.length) return true;
    return new Promise(resolve => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let listener: vscode.Disposable | undefined;
      const finish = (result: boolean) => {
        clearTimeout(timeout);
        listener?.dispose();
        resolve(result);
      };
      listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        const actual = vscode.workspace.workspaceFolders ?? [];
        if (
          actual.length === desired.length &&
          actual.every((folder, index) => folder.uri.toString() === desired[index].uri.toString())
        )
          finish(true);
      });
      timeout = setTimeout(() => finish(false), 15000);
      const added = desired.slice(first).map(({ uri, name }) => ({ uri, name }));
      if (!vscode.workspace.updateWorkspaceFolders(first, current.length - first, ...added))
        finish(false);
    });
  }
}
