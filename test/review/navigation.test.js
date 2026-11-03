const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const vscode = require('vscode');
const { ReviewWorktreeManager } = require('../../src/desktop/review/review_worktree');
const { ReviewNavigation } = require('../../src/desktop/review/review_navigation');
const { toReviewUri, fromReviewUri } = require('../../src/desktop/review/review_uri');
const { CommentingRangeProvider } = require('../../src/desktop/review/commenting_range_provider');
const { REVIEW_URI_SCHEME } = require('../../src/desktop/constants');

const execute = promisify(execFile);
const delay = duration =>
  new Promise(resolve => {
    setTimeout(resolve, duration);
  });
const scheme = 'gitlab-review-navigation-test';
const typescript = "import { added } from './added';\nadded();\n";
const addedTypescript =
  '/** MR-only TypeScript documentation. */ export function added() { return 42; }\n';
const golang = 'package main\n\nfunc main() { _ = added(); _ = documented() }\n';
const documentedGo =
  'package main\n\n// documented returns the MR-only Go documentation value.\nfunc documented() int { return 42 }\n';
const goInterface =
  'package main\n\ntype Worker interface { Added() int }\nfunc invoke(job Worker) int { return job.Added() }\n';
const goImplementation =
  'package main\n\nfunc added() int { return 42 }\n\ntype worker struct{}\nfunc (worker) Added() int { return 42 }\n';

describe('Review definition navigation with real language services', function reviewDefinitionNavigation() {
  this.timeout(60000);
  let directory;
  let repository;
  let snapshot;
  let request;
  let base;
  let navigation;
  let version;
  const disposables = [];

  const git = async (...args) => (await execute('git', ['-C', repository, ...args])).stdout.trim();

  const changeFolder = async (folder, add) => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const index = folders.findIndex(entry => entry.uri.fsPath === folder);
    if ((add && index >= 0) || (!add && index < 0)) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Workspace folder update timed out')),
        15000,
      );
      const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        clearTimeout(timeout);
        listener.dispose();
        resolve();
      });
      const accepted = add
        ? vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
            uri: vscode.Uri.file(folder),
            name: 'Review Navigation Snapshot',
          })
        : vscode.workspace.updateWorkspaceFolders(index, 1);
      if (!accepted) {
        clearTimeout(timeout);
        listener.dispose();
        reject(new Error('Workspace folder update rejected'));
      }
    });
  };

  const reviewUri = (filename, side = 'head') =>
    toReviewUri({
      ...request,
      commit: side === 'base' ? base : request.commit,
      path: `/${filename}`,
      exists: true,
      changeType: 'added',
      side,
    }).with({ scheme });

  const definitionInAddedFile = async (uri, position, destination) => {
    const { filename, command = 'vscode.executeDefinitionProvider' } =
      typeof destination === 'string' ? { filename: destination } : destination;
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const deadline = Date.now() + 40000;
    const query = async () => {
      const results = await vscode.commands.executeCommand(command, uri, position);
      const match = results?.find(result => {
        const target = result.targetUri ?? result.uri;
        return target.scheme === scheme && target.path === `/${filename}`;
      });
      if (match) return match;
      if (Date.now() >= deadline)
        throw new Error(`No definition in ${filename}: ${JSON.stringify(results)}`);
      await delay(500);
      return query();
    };
    return query();
  };

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-language-integration-'));
    repository = path.join(directory, 'repository');
    await fs.mkdir(path.join(repository, 'src'), { recursive: true });
    await git('init', '--initial-branch=main');
    await git('config', 'user.name', 'Review Test');
    await git('config', 'user.email', 'review@example.invalid');
    await fs.writeFile(path.join(repository, 'src/main.ts'), 'export const existing = 1;\n');
    await fs.writeFile(
      path.join(repository, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true },
        include: ['src'],
      }),
    );
    await fs.writeFile(
      path.join(repository, 'go.mod'),
      'module review.test/snapshot\n\ngo 1.22.0\n',
    );
    await fs.writeFile(path.join(repository, 'main.go'), 'package main\n\nfunc main() {}\n');
    await fs.writeFile(path.join(repository, 'worker.go'), goInterface);
    await fs.writeFile(path.join(repository, 'notes.txt'), 'base\n');
    await git('add', '.');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base', '--no-gpg-sign');
    base = await git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(repository, 'src/main.ts'), typescript);
    await fs.writeFile(path.join(repository, 'src/added.ts'), addedTypescript);
    await fs.writeFile(path.join(repository, 'main.go'), golang);
    await fs.writeFile(path.join(repository, 'added.go'), goImplementation);
    await fs.writeFile(path.join(repository, 'documented.go'), documentedGo);
    await git('add', '.');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'MR adds symbols', '--no-gpg-sign');
    request = {
      repositoryRoot: repository,
      projectId: 10,
      mrId: 100,
      mrIid: 7,
      remoteName: 'origin',
      commit: await git('rev-parse', 'HEAD'),
    };
    await git('reset', '--hard', base);
    await fs.appendFile(path.join(repository, 'notes.txt'), 'unsaved local work\n');
    const manager = new ReviewWorktreeManager(path.join(directory, 'cache'), 'git');
    snapshot = await manager.ensure(request);
    await changeFolder(snapshot, true);
    version = {
      base_commit_sha: base,
      head_commit_sha: request.commit,
      start_commit_sha: base,
      diffs: [
        {
          old_path: 'src/added.ts',
          new_path: 'src/added.ts',
          new_file: true,
          diff: `@@ -0,0 +1 @@\n+${addedTypescript}`,
        },
        {
          old_path: 'added.go',
          new_path: 'added.go',
          new_file: true,
          diff: `@@ -0,0 +1,6 @@\n${goImplementation
            .trimEnd()
            .split('\n')
            .map(line => `+${line}`)
            .join('\n')}\n`,
        },
      ],
    };
    navigation = new ReviewNavigation(
      manager,
      params => (params.commit === request.commit ? request : undefined),
      () => version,
    );
    disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(scheme, {
        provideTextDocumentContent: async uri => {
          const params = fromReviewUri(uri);
          if (!params.exists) return '';
          return (
            await execute('git', [
              '-C',
              repository,
              'show',
              `${params.commit}:${uri.path.slice(1)}`,
            ])
          ).stdout;
        },
      }),
    );
    disposables.push(vscode.languages.registerDefinitionProvider({ scheme }, navigation));
    disposables.push(vscode.languages.registerImplementationProvider({ scheme }, navigation));
    disposables.push(vscode.languages.registerHoverProvider({ scheme }, navigation));
    disposables.push(navigation.listen());
    await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
  });

  after(async () => {
    disposables.forEach(disposable => disposable.dispose());
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    if (snapshot) await changeFolder(snapshot, false);
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('F12 resolves a newly added TypeScript function in a newly added file, not the current branch', async () => {
    const target = await definitionInAddedFile(
      reviewUri('src/main.ts'),
      new vscode.Position(1, 2),
      'src/added.ts',
    );
    assert.strictEqual((target.targetSelectionRange ?? target.range).start.line, 0);
    assert.strictEqual(fromReviewUri(target.targetUri ?? target.uri).commit, request.commit);
    await assert.rejects(fs.access(path.join(repository, 'src/added.ts')));
  });

  const assertHoverInDiff = async (filename, position, { marker, signature }) => {
    const uri = reviewUri(filename);
    await vscode.commands.executeCommand(
      'vscode.diff',
      reviewUri(filename, 'base'),
      uri,
      'Hover test MR',
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const deadline = Date.now() + 40000;
    const query = async () => {
      const results = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        uri,
        position,
      );
      const contents = (results ?? [])
        .flatMap(hover => hover.contents)
        .map(content => (typeof content === 'string' ? content : content.value))
        .join('\n');
      if (contents.includes(marker) || Date.now() >= deadline) return contents;
      await delay(500);
      return query();
    };
    const contents = await query();
    assert.ok(contents.includes(marker), `Missing ${marker}: ${contents}`);
    assert.ok(contents.includes(signature), `Missing ${signature}: ${contents}`);
    const active = vscode.window.tabGroups.activeTabGroup.activeTab.input;
    assert.ok(active instanceof vscode.TabInputTextDiff);
    assert.strictEqual(active.modified.toString(), uri.toString());
    assert.strictEqual(document.isDirty, false);
    assert.ok(
      !vscode.window.visibleTextEditors.some(
        editor =>
          editor.document.uri.scheme === 'file' && editor.document.uri.fsPath.startsWith(snapshot),
      ),
    );
  };

  it('previews the new TypeScript function signature and documentation inside the MR diff', async () => {
    await assertHoverInDiff('src/main.ts', new vscode.Position(1, 2), {
      marker: 'MR-only TypeScript documentation',
      signature: 'added(): number',
    });
    await assert.rejects(fs.access(path.join(repository, 'src/added.ts')));
  });

  it('previews added Go function documentation using real gopls without leaving the MR diff', async function goHoverDocumentation() {
    if (!process.env.REVIEW_TEST_GOPLS_PATH) this.skip();
    await vscode.extensions.getExtension('golang.go').activate();
    await assertHoverInDiff(
      'main.go',
      new vscode.Position(2, golang.split('\n')[2].indexOf('documented') + 2),
      { marker: 'MR-only Go documentation', signature: 'documented() int' },
    );
    await assert.rejects(fs.access(path.join(repository, 'documented.go')));
  });

  it('reuses the same snapshot and leaves the developer branch and dirty files untouched', async () => {
    await definitionInAddedFile(
      reviewUri('src/main.ts'),
      new vscode.Position(1, 2),
      'src/added.ts',
    );
    assert.strictEqual(await git('branch', '--show-current'), 'main');
    assert.strictEqual(await git('rev-parse', 'HEAD'), base);
    assert.strictEqual(
      await fs.readFile(path.join(repository, 'notes.txt'), 'utf8'),
      'base\nunsaved local work\n',
    );
    assert.strictEqual(
      (await git('worktree', 'list', '--porcelain')).match(/^worktree /gm).length,
      2,
    );
  });

  it('does not substitute head definitions for the old side', async () => {
    const uri = reviewUri('src/main.ts', 'base');
    const document = await vscode.workspace.openTextDocument(uri);
    assert.strictEqual(
      await navigation.provideDefinition(
        document,
        new vscode.Position(0, 14),
        new vscode.CancellationTokenSource().token,
      ),
      undefined,
    );
    const results = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      uri,
      new vscode.Position(1, 2),
    );
    assert.ok(
      !results?.some(result => (result.targetUri ?? result.uri).path.endsWith('/added.ts')),
      JSON.stringify(results),
    );
  });

  it('opens an added Go definition from the real gopls result in its MR diff', async function goDefinitionNavigation() {
    if (!process.env.REVIEW_TEST_GOPLS_PATH) this.skip();
    const extension = vscode.extensions.getExtension('golang.go');
    assert.ok(extension, 'Run with REVIEW_TEST_EXTENSIONS_DIR containing golang.go');
    await extension.activate();
    const target = await definitionInAddedFile(
      reviewUri('main.go'),
      new vscode.Position(2, golang.split('\n')[2].indexOf('added') + 2),
      'added.go',
    );
    assert.strictEqual((target.targetSelectionRange ?? target.range).start.line, 2);
    await vscode.window.showTextDocument(target.targetUri ?? target.uri, {
      selection: target.targetSelectionRange ?? target.range,
    });
    const deadline = Date.now() + 10000;
    const waitForTarget = async () => {
      if (
        vscode.window.activeTextEditor?.document.uri.toString() ===
          reviewUri('added.go').toString() &&
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
      )
        return;
      if (Date.now() >= deadline) return;
      await delay(50);
      await waitForTarget();
    };
    await waitForTarget();
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      reviewUri('added.go').toString(),
    );
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(
      input instanceof vscode.TabInputTextDiff,
      'F12 must open the target MR diff, not a single file',
    );
    assert.strictEqual(input.modified.toString(), reviewUri('added.go').toString());
    const original = fromReviewUri(input.original);
    assert.strictEqual(original.commit, base);
    assert.strictEqual(original.exists, false);
    assert.strictEqual(original.side, 'base');
    assert.strictEqual(original.mrId, request.mrId);
    assert.strictEqual(vscode.window.activeTextEditor.selection.start.line, 2);
    const { document } = vscode.window.activeTextEditor;
    const params = fromReviewUri(document.uri);
    assert.strictEqual(params.mrId, request.mrId);
    assert.strictEqual(params.commit, request.commit);
    const ranges = new CommentingRangeProvider(
      { id: request.mrId, project_id: request.projectId },
      version,
    ).provideCommentingRanges({ uri: document.uri.with({ scheme: REVIEW_URI_SCHEME }) });
    assert.ok(
      ranges.some(
        range => range.start.line === (target.targetSelectionRange ?? target.range).start.line,
      ),
      'Added definition must remain on a commentable MR line',
    );
  });

  it('opens the real gopls implementation result in its MR diff rather than the interface declaration', async function goImplementationNavigation() {
    if (!process.env.REVIEW_TEST_GOPLS_PATH) this.skip();
    await vscode.extensions.getExtension('golang.go').activate();
    const uri = reviewUri('worker.go');
    const position = new vscode.Position(3, goInterface.split('\n')[3].indexOf('Added') + 2);
    const definition = await definitionInAddedFile(uri, position, 'worker.go');
    assert.strictEqual((definition.targetSelectionRange ?? definition.range).start.line, 2);
    const target = await definitionInAddedFile(uri, position, {
      filename: 'added.go',
      command: 'vscode.executeImplementationProvider',
    });
    assert.strictEqual((target.targetSelectionRange ?? target.range).start.line, 5);
    await vscode.window.showTextDocument(target.targetUri ?? target.uri, {
      selection: target.targetSelectionRange ?? target.range,
    });
    const deadline = Date.now() + 10000;
    const waitForTarget = async () => {
      if (
        vscode.window.activeTextEditor?.document.uri.toString() ===
          reviewUri('added.go').toString() &&
        vscode.window.activeTextEditor.selection.start.line === 5 &&
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
      )
        return;
      if (Date.now() >= deadline) return;
      await delay(50);
      await waitForTarget();
    };
    await waitForTarget();
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      reviewUri('added.go').toString(),
    );
    assert.strictEqual(vscode.window.activeTextEditor.selection.start.line, 5);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff);
    assert.strictEqual(fromReviewUri(input.original).commit, base);
    assert.strictEqual(fromReviewUri(input.modified).commit, request.commit);
    assert.strictEqual(fromReviewUri(input.modified).mrId, request.mrId);
    const ranges = new CommentingRangeProvider(
      { id: request.mrId, project_id: request.projectId },
      version,
    ).provideCommentingRanges({ uri: input.modified.with({ scheme: REVIEW_URI_SCHEME }) });
    assert.ok(ranges.some(range => range.start.line === 5));
  });
});
