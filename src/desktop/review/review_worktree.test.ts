import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReviewWorktreeManager, ReviewWorktreeRequest } from './review_worktree';

const execute = promisify(execFile);

describe('ReviewWorktreeManager', () => {
  let directory: string;
  let repositoryRoot: string;
  let manager: ReviewWorktreeManager;
  let request: ReviewWorktreeRequest;
  let baseCommit: string;

  const git = async (...args: string[]) =>
    (await execute('git', ['-C', repositoryRoot, ...args])).stdout.trim();

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-worktree-test-'));
    repositoryRoot = path.join(directory, 'repository');
    await fs.mkdir(repositoryRoot);
    await git('init', '--initial-branch=main');
    await git('config', 'user.name', 'Review Test');
    await git('config', 'user.email', 'review@example.invalid');
    await fs.writeFile(path.join(repositoryRoot, 'existing.ts'), 'export const existing = 1;\n');
    await git('add', '.');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base', '--no-gpg-sign');
    baseCommit = await git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(repositoryRoot, 'added.ts'), 'export const added = 2;\n');
    await git('add', '.');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'MR head', '--no-gpg-sign');
    const commit = await git('rev-parse', 'HEAD');
    await git('reset', '--hard', baseCommit);
    await fs.appendFile(path.join(repositoryRoot, 'existing.ts'), '// local changes\n');
    request = { repositoryRoot, projectId: 10, mrId: 100, mrIid: 7, remoteName: 'origin', commit };
    manager = new ReviewWorktreeManager(path.join(directory, 'cache'), 'git');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('materializes added files at the exact MR commit without switching or changing the checkout', async () => {
    const before = await git('status', '--porcelain');
    const worktree = await manager.ensure(request);
    expect(await fs.readFile(path.join(worktree, 'added.ts'), 'utf8')).toBe(
      'export const added = 2;\n',
    );
    expect((await execute('git', ['-C', worktree, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(
      request.commit,
    );
    expect(await git('branch', '--show-current')).toBe('main');
    expect(await git('rev-parse', 'HEAD')).toBe(baseCommit);
    expect(await git('status', '--porcelain')).toBe(before);
    await expect(fs.access(path.join(repositoryRoot, 'added.ts'))).rejects.toThrow();
  });

  it('reuses the same immutable snapshot, including concurrent requests', async () => {
    const results = await Promise.all([manager.ensure(request), manager.ensure(request)]);
    expect(results[0]).toBe(results[1]);
    expect(await manager.ensure(request)).toBe(results[0]);
    expect((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(2);
  });

  it('reuses a prepared snapshot from the previous extension ID', async () => {
    const previousStorage = path.join(directory, 'previous-cache');
    const previous = new ReviewWorktreeManager(previousStorage, 'git');
    const original = await previous.ensure(request);
    const current = new ReviewWorktreeManager(path.join(directory, 'cache'), 'git', [
      previousStorage,
    ]);
    expect(current.getPath(request)).toBe(original);
    expect(await current.ensure(request)).toBe(original);
    expect(await current.findPrepared(request)).toEqual(request);
    expect((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(2);
  });

  it('lists and removes only clean registered review snapshots after final eligibility checks', async () => {
    const target = await manager.ensure(request);
    expect(await manager.listPrepared()).toEqual([{ root: target, request }]);
    expect(await manager.removePrepared({ root: target, request }, () => false)).toBe(false);
    expect(await manager.removePrepared({ root: target, request }, () => true)).toBe(true);
    await expect(fs.access(target)).rejects.toThrow();
    await expect(fs.access(`${target}.json`)).rejects.toThrow();
    expect(await git('rev-parse', 'HEAD')).toBe(baseCommit);
    expect(await fs.readFile(path.join(repositoryRoot, 'existing.ts'), 'utf8')).toContain(
      'local changes',
    );
  });

  it.each(['tracked', 'untracked', 'ignored'])(
    'preserves snapshots with %s local data during cleanup',
    async kind => {
      const root = await manager.ensure(request);
      if (kind === 'tracked') await fs.writeFile(path.join(root, 'added.ts'), 'local changes');
      if (kind === 'untracked') await fs.writeFile(path.join(root, 'notes.txt'), 'local work');
      if (kind === 'ignored') {
        await fs.appendFile(path.join(repositoryRoot, '.git/info/exclude'), '\ndependencies/\n');
        await fs.mkdir(path.join(root, 'dependencies'));
        await fs.writeFile(path.join(root, 'dependencies/local.txt'), 'keep');
      }
      expect(await manager.removePrepared({ root, request }, () => true)).toBe(false);
      expect(await fs.readFile(`${root}.json`, 'utf8')).toContain(request.commit);
    },
  );

  it('only maps files present in the exact commit, not generated files or directories', async () => {
    expect(await manager.hasFile(request, 'added.ts')).toBe(true);
    expect(await manager.hasFile(request, 'existing.ts')).toBe(true);
    expect(await manager.hasFile(request, 'node_modules/library/index.js')).toBe(false);
    expect(await manager.hasFile(request, '')).toBe(false);
  });

  it('looks up prepared snapshots without creating missing worktrees or cache directories', async () => {
    expect(await manager.getPrepared(request)).toBeUndefined();
    await expect(fs.access(path.join(directory, 'cache'))).rejects.toThrow();
    expect((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
    const worktree = await manager.ensure(request);
    expect(await manager.getPrepared(request)).toBe(worktree);
  });

  it('rejects modified prepared snapshots during passive lookup', async () => {
    const worktree = await manager.ensure(request);
    await fs.writeFile(path.join(worktree, 'added.ts'), 'export const wrong = 3;\n');
    await expect(manager.getPrepared(request)).rejects.toThrow(/modified/i);
  });

  it('persists prepared head metadata for extension-host restarts', async () => {
    await manager.ensure(request);
    const restarted = new ReviewWorktreeManager(path.join(directory, 'cache'), 'git');
    expect(await restarted.findPrepared(request)).toEqual(request);
    expect(await restarted.findPrepared({ ...request, commit: baseCommit })).toBeUndefined();
  });

  it('creates a different snapshot when the MR commit changes', async () => {
    const first = await manager.ensure(request);
    const second = await manager.ensure({ ...request, commit: baseCommit });
    expect(second).not.toBe(first);
    await expect(fs.access(path.join(second, 'added.ts'))).rejects.toThrow();
    expect(await fs.readFile(path.join(first, 'added.ts'), 'utf8')).toContain('added');
  });

  it('refuses to reuse an edited snapshot rather than returning incorrect definitions', async () => {
    const worktree = await manager.ensure(request);
    await fs.writeFile(path.join(worktree, 'added.ts'), 'export const wrong = 3;\n');
    await expect(manager.ensure(request)).rejects.toThrow(/modified/i);
    expect(await fs.readFile(path.join(worktree, 'added.ts'), 'utf8')).toContain('wrong');
  });

  it('rejects an existing directory that is not the expected worktree', async () => {
    await fs.mkdir(manager.getPath(request), { recursive: true });
    await fs.writeFile(path.join(manager.getPath(request), 'sentinel'), 'keep');
    await expect(manager.ensure(request)).rejects.toThrow();
    expect(await fs.readFile(path.join(manager.getPath(request), 'sentinel'), 'utf8')).toBe('keep');
  });

  it('fetches missing MR objects from the target remote without moving local branches', async () => {
    const remote = path.join(directory, 'remote');
    await execute('git', ['clone', '--bare', repositoryRoot, remote]);
    await execute('git', [
      '-C',
      remote,
      'update-ref',
      'refs/merge-requests/7/head',
      request.commit,
    ]);
    const clone = path.join(directory, 'clone');
    await execute('git', ['clone', '--no-local', remote, clone]);
    repositoryRoot = clone;
    await expect(
      execute('git', ['-C', clone, 'cat-file', '-e', `${request.commit}^{commit}`]),
    ).rejects.toThrow();
    expect(
      (await execute('git', ['-C', clone, 'cat-file', '-e', `${baseCommit}^{commit}`])).stderr,
    ).toBe('');
    const fetched = await manager.ensure({ ...request, repositoryRoot: clone });
    expect(await fs.readFile(path.join(fetched, 'added.ts'), 'utf8')).toContain('added');
    expect(await git('rev-parse', 'HEAD')).toBe(baseCommit);
    await expect(fs.access(path.join(clone, '.git', 'FETCH_HEAD'))).rejects.toThrow();
  });

  it('rejects invalid commit and MR identifiers before invoking Git', async () => {
    await expect(manager.ensure({ ...request, commit: '--help' })).rejects.toThrow(/commit/i);
    await expect(manager.ensure({ ...request, mrIid: -1 })).rejects.toThrow(/merge request/i);
  });
});
