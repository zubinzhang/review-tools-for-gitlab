import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface ReviewWorktreeRequest {
  repositoryRoot: string;
  projectId: number;
  mrId: number;
  mrIid: number;
  remoteName: string;
  commit: string;
}

export class ReviewWorktreeManager {
  #pending = new Map<string, Promise<string>>();

  constructor(
    private readonly storagePath: string,
    private readonly gitPath: string,
  ) {}

  getPath(
    request: Pick<ReviewWorktreeRequest, 'repositoryRoot' | 'projectId' | 'mrId' | 'commit'>,
  ): string {
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          path.resolve(request.repositoryRoot),
          request.projectId,
          request.mrId,
          request.commit,
        ]),
      )
      .digest('hex');
    return path.join(this.storagePath, `${key.slice(0, 24)}-${request.commit.slice(0, 12)}`);
  }

  async ensure(request: ReviewWorktreeRequest): Promise<string> {
    this.#validate(request);
    const target = this.getPath(request);
    const pending = this.#pending.get(target);
    if (pending) return pending;
    const preparation = this.#prepare(request, target);
    this.#pending.set(target, preparation);
    try {
      return await preparation;
    } finally {
      this.#pending.delete(target);
    }
  }

  async hasFile(request: ReviewWorktreeRequest, relativePath: string): Promise<boolean> {
    this.#validate(request);
    try {
      const type = await this.#git(request.repositoryRoot, [
        'cat-file',
        '-t',
        `${request.commit}:${relativePath}`,
      ]);
      return type === 'blob';
    } catch {
      return false;
    }
  }

  async getPrepared(request: ReviewWorktreeRequest): Promise<string | undefined> {
    this.#validate(request);
    const target = this.getPath(request);
    const exists = await fs.lstat(target).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    return exists ? this.#verify(request, target) : undefined;
  }

  async findPrepared(
    request: Pick<ReviewWorktreeRequest, 'repositoryRoot' | 'projectId' | 'mrId' | 'commit'>,
  ): Promise<ReviewWorktreeRequest | undefined> {
    try {
      const saved: ReviewWorktreeRequest = JSON.parse(
        await fs.readFile(`${this.getPath(request)}.json`, 'utf8'),
      );
      this.#validate(saved);
      if (
        saved.repositoryRoot !== request.repositoryRoot ||
        saved.projectId !== request.projectId ||
        saved.mrId !== request.mrId ||
        saved.commit !== request.commit
      )
        return undefined;
      return saved;
    } catch {
      return undefined;
    }
  }

  #validate(request: ReviewWorktreeRequest): void {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request.commit)) {
      throw new Error(
        'Code navigation requires an exact full commit SHA. Refresh the merge request.',
      );
    }
    if (
      ![request.mrIid, request.mrId, request.projectId].every(
        value => Number.isSafeInteger(value) && value > 0,
      )
    ) {
      throw new Error('Invalid merge request identity. Refresh the merge request.');
    }
    if (!path.isAbsolute(request.repositoryRoot) || !/^[\w][\w./-]*$/.test(request.remoteName)) {
      throw new Error('Invalid repository or Git remote for code navigation.');
    }
  }

  async #git(repository: string, args: string[]): Promise<string> {
    const result = await execute(
      this.gitPath,
      [
        '-c',
        `core.hooksPath=${path.join(this.storagePath, 'disabled-hooks')}`,
        '-C',
        repository,
        ...args,
      ],
      {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
    );
    return result.stdout.trim();
  }

  async #prepare(request: ReviewWorktreeRequest, target: string): Promise<string> {
    await fs.mkdir(this.storagePath, { recursive: true });
    const existing = await fs.lstat(target).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!existing) {
      try {
        await this.#git(request.repositoryRoot, ['cat-file', '-e', `${request.commit}^{commit}`]);
      } catch {
        try {
          await this.#git(request.repositoryRoot, [
            'fetch',
            '--no-tags',
            '--no-write-fetch-head',
            '--no-recurse-submodules',
            '--',
            request.remoteName,
            `refs/merge-requests/${request.mrIid}/head`,
          ]);
          await this.#git(request.repositoryRoot, ['cat-file', '-e', `${request.commit}^{commit}`]);
        } catch {
          throw new Error(
            'Could not fetch the exact MR commit. Check Git remote authentication and refresh the MR; no branch was switched.',
          );
        }
      }
      try {
        await this.#git(request.repositoryRoot, [
          'worktree',
          'add',
          '--detach',
          '--',
          target,
          request.commit,
        ]);
      } catch {
        if (!(await fs.lstat(target).catch(() => undefined))) {
          throw new Error(
            'Could not create the review worktree. Check Git and available disk space.',
          );
        }
      }
    }
    await this.#verify(request, target);
    await fs.writeFile(`${target}.json`, JSON.stringify(request), { mode: 0o600 });
    return target;
  }

  async #verify(request: ReviewWorktreeRequest, target: string): Promise<string> {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('The review cache path is not a worktree directory.');
    const root = await this.#git(target, ['rev-parse', '--show-toplevel']);
    const head = await this.#git(target, ['rev-parse', 'HEAD']);
    const common = await this.#git(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    const expectedCommon = await this.#git(request.repositoryRoot, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    if (
      (await fs.realpath(root)) !== (await fs.realpath(target)) ||
      head !== request.commit ||
      (await fs.realpath(common)) !== (await fs.realpath(expectedCommon))
    ) {
      throw new Error(
        'The review cache does not match the requested repository and commit. It was not overwritten.',
      );
    }
    if (await this.#git(target, ['status', '--porcelain', '--untracked-files=normal'])) {
      throw new Error(
        'This review worktree was modified. Save your changes elsewhere and restore it before navigating; it was not overwritten.',
      );
    }
    return target;
  }
}
