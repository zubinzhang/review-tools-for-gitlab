import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { ReviewWorkspace } from './review_workspace';
import { toReviewUri } from './review_uri';
import { ReviewCacheCleanup } from './review_cache_cleanup';
import { ReviewWorktreeManager } from './review_worktree';

describe('ReviewWorkspace', () => {
  let directory: string;
  let storage: string;
  let legacy: string;
  let workspace: ReviewWorkspace;
  let folders: vscode.WorkspaceFolder[];
  const folder = (root: string, index: number) => ({
    uri: vscode.Uri.file(root),
    name: path.basename(root),
    index,
  });
  const identity = {
    repositoryRoot: '/original',
    projectId: 10,
    mrId: 100,
    mrIid: 7,
    remoteName: 'origin',
    commit: 'a'.repeat(40),
  };

  const snapshot = async (root: string, commit = identity.commit) => {
    const target = path.join(root, `${'b'.repeat(24)}-${commit.slice(0, 12)}`);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(`${target}.json`, JSON.stringify({ ...identity, commit }));
    await fs.writeFile(path.join(target, 'sentinel'), 'keep');
    return target;
  };

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-workspace-test-'));
    storage = path.join(directory, 'current', 'review-worktrees');
    legacy = path.join(directory, 'legacy', 'review-worktrees');
    workspace = new ReviewWorkspace(storage, [legacy]);
    folders = [folder('/original', 0)];
    Object.defineProperty(vscode.window, 'tabGroups', { configurable: true, value: { all: [] } });
    Object.defineProperty(vscode.workspace, 'textDocuments', { configurable: true, value: [] });
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      configurable: true,
      get: () => folders,
    });
    let changed: () => void;
    jest.mocked(vscode.workspace.onDidChangeWorkspaceFolders).mockImplementation(callback => {
      changed = () => callback({ added: [], removed: [] });
      return new vscode.Disposable(() => {});
    });
    jest
      .mocked(vscode.workspace.updateWorkspaceFolders)
      .mockImplementation((start, count, ...added) => {
        folders.splice(
          start,
          count ?? 0,
          ...added.map((entry, index) => ({
            ...entry,
            name: entry.name ?? '',
            index: start + index,
          })),
        );
        changed();
        return true;
      });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('recognizes both extension IDs without excluding ordinary or similarly named repositories', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    expect(workspace.isReviewRoot(current)).toBe(true);
    expect(workspace.isReviewRoot(old)).toBe(true);
    expect(workspace.isReviewRoot('/original')).toBe(false);
    expect(workspace.isReviewRoot(`${storage}-other/repo`)).toBe(false);
  });

  it('keeps one workspace folder per MR revision across extension IDs, preserving other revisions and files', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    const other = await snapshot(legacy, 'c'.repeat(40));
    folders.push(folder(old, 1), folder(other, 2), folder(current, 3));
    expect(await workspace.deduplicate()).toBe(true);
    expect(folders.map(entry => entry.uri.fsPath)).toEqual(['/original', other, current]);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledWith(
      1,
      3,
      { uri: vscode.Uri.file(other), name: path.basename(other) },
      { uri: vscode.Uri.file(current), name: path.basename(current) },
    );
    expect(await fs.readFile(path.join(old, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('does not merge distinct source checkouts or user folders named Review', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    await fs.writeFile(
      `${old}.json`,
      JSON.stringify({ ...identity, repositoryRoot: '/another-checkout' }),
    );
    folders.push(folder(current, 1), folder(old, 2), {
      ...folder('/user/review', 3),
      name: 'Review !7',
    });
    await workspace.deduplicate();
    expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('recognizes symlink aliases and avoids adding a second copy during concurrent requests', async () => {
    const current = await snapshot(storage);
    const alias = path.join(directory, 'alias');
    await fs.symlink(current, alias, 'dir');
    folders.push(folder(alias, 1));
    expect(workspace.isIncluded(current)).toBe(true);
    expect(workspace.isReviewRoot(alias)).toBe(true);
    await Promise.all([workspace.include(current, identity), workspace.include(alias, identity)]);
    expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('serializes additions and waits for folder events before another update', async () => {
    const current = await snapshot(storage);
    await Promise.all([workspace.include(current, identity), workspace.include(current, identity)]);
    expect(folders).toHaveLength(2);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledTimes(1);
  });

  it('does not remove managed folders with missing or malformed identity metadata', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    await fs.writeFile(`${old}.json`, '{}');
    folders.push(folder(current, 1), folder(old, 2));
    await workspace.deduplicate();
    expect(folders).toHaveLength(3);
  });

  it('removes stale workspace entries left behind after an old extension cache directory disappears', async () => {
    const missing = path.join(legacy, `${'b'.repeat(24)}-${'a'.repeat(12)}`);
    folders.push(folder(missing, 1));
    await workspace.deduplicate();
    expect(folders.map(entry => entry.uri.fsPath)).toEqual(['/original']);
  });

  it('reports rejected workspace updates without changing folders or deleting files', async () => {
    const current = await snapshot(storage);
    jest.mocked(vscode.workspace.updateWorkspaceFolders).mockReturnValue(false);
    expect(await workspace.include(current, identity)).toBe(false);
    expect(folders).toHaveLength(1);
    expect(await fs.readFile(path.join(current, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('retains duplicate snapshots while either has unsaved or open physical source files', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    folders.push(folder(current, 1), folder(old, 2));
    Object.defineProperty(vscode.workspace, 'textDocuments', {
      configurable: true,
      value: [{ uri: vscode.Uri.file(path.join(old, 'sentinel')), isDirty: true }],
    });
    await workspace.deduplicate();
    expect(folders).toHaveLength(3);
  });

  it('cancels automatic cleanup when disposed', async () => {
    const current = await snapshot(storage);
    folders.push(folder(current, 1));
    Object.defineProperty(vscode.window, 'tabGroups', {
      configurable: true,
      value: {
        all: [],
        onDidChangeTabs: jest.fn(() => new vscode.Disposable(() => {})),
        onDidChangeTabGroups: jest.fn(() => new vscode.Disposable(() => {})),
      },
    });
    jest.useFakeTimers();
    const listener = workspace.listen();
    listener.dispose();
    await jest.advanceTimersByTimeAsync(30000);
    expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('retains the selected MR before any diff tab opens and releases it after selection changes', async () => {
    const current = await snapshot(storage);
    folders.push(folder(current, 1));
    workspace.setSelectedReview(identity);
    await workspace.removeInactive();
    expect(folders).toHaveLength(2);
    workspace.setSelectedReview(undefined);
    await workspace.removeInactive();
    expect(folders).toHaveLength(1);
  });

  it('automatically detaches closed reviews after a grace period, retaining open reviews and disk files', async () => {
    const current = await snapshot(storage);
    const other = await snapshot(legacy, 'c'.repeat(40));
    folders.push(folder(current, 1), folder(other, 2));
    const uri = toReviewUri({
      ...identity,
      path: '/main.ts',
      side: 'head',
      exists: true,
      changeType: 'modified',
    });
    const tabs = [{ input: new vscode.TabInputTextDiff(uri, uri) }];
    let changed: () => void;
    Object.defineProperty(vscode.window, 'tabGroups', {
      configurable: true,
      value: {
        all: [{ tabs }],
        onDidChangeTabs: jest.fn(callback => {
          changed = callback;
          return new vscode.Disposable(() => {});
        }),
        onDidChangeTabGroups: jest.fn(() => new vscode.Disposable(() => {})),
      },
    });
    jest.useFakeTimers();
    const listener = workspace.listen();
    await jest.advanceTimersByTimeAsync(29999);
    expect(folders).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(folders.map(entry => entry.uri.fsPath)).toEqual(['/original', current]);
    tabs.splice(0);
    changed!();
    await jest.advanceTimersByTimeAsync(30000);
    expect(folders.map(entry => entry.uri.fsPath)).toEqual(['/original']);
    expect(await fs.readFile(path.join(current, 'sentinel'), 'utf8')).toBe('keep');
    expect(await fs.readFile(path.join(other, 'sentinel'), 'utf8')).toBe('keep');
    listener.dispose();
  });

  it('keeps worktrees with open physical source tabs or unsaved documents', async () => {
    const current = await snapshot(storage);
    folders.push(folder(current, 1));
    const uri = vscode.Uri.file(path.join(current, 'sentinel'));
    Object.defineProperty(vscode.window, 'tabGroups', {
      configurable: true,
      value: { all: [{ tabs: [{ input: new vscode.TabInputText(uri) }] }] },
    });
    await workspace.removeInactive();
    expect(folders).toHaveLength(2);
    Object.defineProperty(vscode.window, 'tabGroups', { configurable: true, value: { all: [] } });
    Object.defineProperty(vscode.workspace, 'textDocuments', {
      configurable: true,
      value: [{ uri, isDirty: true }],
    });
    await workspace.removeInactive();
    expect(folders).toHaveLength(2);
    Object.defineProperty(vscode.workspace, 'textDocuments', { configurable: true, value: [] });
    await workspace.removeInactive();
    expect(folders).toHaveLength(1);
  });

  it('only deletes confirmed closed or merged MRs and batches status checks across cached revisions', async () => {
    const current = await snapshot(storage);
    const other = await snapshot(legacy, 'c'.repeat(40));
    const snapshots = [
      { root: current, request: identity },
      { root: other, request: { ...identity, commit: 'c'.repeat(40) } },
    ];
    const remove = jest.fn().mockResolvedValue(true);
    const manager = createFakePartial<ReviewWorktreeManager>({
      listPrepared: jest.fn().mockResolvedValue(snapshots),
      removePrepared: remove,
    });
    const resolve = jest.fn().mockResolvedValue('opened');
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    await new ReviewCacheCleanup(manager, workspace, resolve).run();
    expect(remove).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(1);
    resolve.mockResolvedValue('closed');
    await new ReviewCacheCleanup(manager, workspace, resolve).run();
    resolve.mockResolvedValue('merged');
    await new ReviewCacheCleanup(manager, workspace, resolve).run();
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('keeps caches after failed or unknown MR status and skips active reviews', async () => {
    const current = await snapshot(storage);
    const manager = createFakePartial<ReviewWorktreeManager>({
      listPrepared: jest.fn().mockResolvedValue([{ root: current, request: identity }]),
      removePrepared: jest.fn(),
    });
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    await new ReviewCacheCleanup(
      manager,
      workspace,
      jest.fn().mockRejectedValue(new Error('offline')),
    ).run();
    await new ReviewCacheCleanup(manager, workspace, jest.fn().mockResolvedValue(undefined)).run();
    Object.defineProperty(vscode.workspace, 'textDocuments', {
      configurable: true,
      value: [{ uri: vscode.Uri.file(path.join(current, 'sentinel')), isDirty: true }],
    });
    await new ReviewCacheCleanup(manager, workspace, jest.fn().mockResolvedValue('merged')).run();
    expect(manager.removePrepared).not.toHaveBeenCalled();
  });

  it('cleans existing duplicate caches while keeping one revision for an open MR', async () => {
    const current = await snapshot(storage);
    const old = await snapshot(legacy);
    const manager = createFakePartial<ReviewWorktreeManager>({
      listPrepared: jest.fn().mockResolvedValue([
        { root: current, request: identity },
        { root: old, request: identity },
      ]),
      getPath: jest.fn().mockReturnValue(current),
      removePrepared: jest.fn().mockResolvedValue(true),
    });
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    await new ReviewCacheCleanup(manager, workspace, jest.fn().mockResolvedValue('opened')).run();
    expect(manager.removePrepared).toHaveBeenCalledTimes(1);
    expect(manager.removePrepared).toHaveBeenCalledWith(
      { root: old, request: identity },
      expect.any(Function),
    );
  });
});
