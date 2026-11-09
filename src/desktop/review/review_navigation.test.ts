import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getBaseAndHeadUri } from '../tree_view/items/changed_file_item';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { mrCache } from '../gitlab/mr_cache';
import { getProjectRepository } from '../gitlab/gitlab_project_repository';
import { projectInRepository, mr, mrVersion } from '../test_utils/entities';
import { toReviewUri, fromReviewUri, ReviewParams } from './review_uri';
import { ReviewWorktreeManager, ReviewWorktreeRequest } from './review_worktree';
import { ReviewNavigation, getReviewNavigationRequest } from './review_navigation';

jest.mock('../gitlab/mr_cache');
jest.mock('../gitlab/gitlab_project_repository');

describe('ReviewNavigation', () => {
  let directory: string;
  let worktree: string;
  let request: ReviewWorktreeRequest;
  let manager: ReviewWorktreeManager;
  let navigation: ReviewNavigation;
  let params: ReviewParams;
  let document: vscode.TextDocument;
  const position = new vscode.Position(1, 3);
  const token = createFakePartial<vscode.CancellationToken>({ isCancellationRequested: false });
  const content = "import { added } from './added';\nadded();\n";
  const setFolders = (included: boolean) => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      configurable: true,
      value: [{ uri: vscode.Uri.file(included ? worktree : '/original'), name: 'repo', index: 0 }],
    });
  };
  const acceptPreparation = () => {
    setFolders(false);
    jest
      .mocked(vscode.window.showInformationMessage)
      .mockResolvedValue('Prepare Review Workspace' as never);
    let listener: () => void;
    jest.mocked(vscode.workspace.onDidChangeWorkspaceFolders).mockImplementation(callback => {
      listener = () => callback({ added: [], removed: [] });
      return new vscode.Disposable(() => {});
    });
    jest
      .mocked(vscode.workspace.updateWorkspaceFolders)
      .mockImplementation((start, count, ...added) => {
        const folders = [...(vscode.workspace.workspaceFolders ?? [])];
        folders.splice(
          start,
          count ?? 0,
          ...added.map((entry, index) => ({
            ...entry,
            name: entry.name ?? '',
            index: start + index,
          })),
        );
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
          configurable: true,
          value: folders,
        });
        listener();
        return true;
      });
  };

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-navigation-test-'));
    worktree = path.join(directory, 'snapshot');
    await fs.mkdir(worktree);
    await fs.writeFile(path.join(worktree, 'main.ts'), content);
    await fs.writeFile(path.join(worktree, 'added.ts'), content);
    request = {
      repositoryRoot: '/original',
      projectId: 10,
      mrId: 100,
      mrIid: 7,
      remoteName: 'origin',
      commit: 'a'.repeat(40),
    };
    params = { ...request, path: '/main.ts', exists: true, changeType: 'added', side: 'head' };
    manager = createFakePartial<ReviewWorktreeManager>({
      storagePath: directory,
      previousStoragePaths: [],
      getPath: jest.fn().mockReturnValue(worktree),
      ensure: jest.fn().mockResolvedValue(worktree),
      getPrepared: jest.fn().mockResolvedValue(worktree),
      findPrepared: jest.fn().mockResolvedValue(undefined),
      hasFile: jest.fn().mockResolvedValue(true),
    });
    navigation = new ReviewNavigation(manager, () => request);
    document = createFakePartial<vscode.TextDocument>({
      uri: toReviewUri(params),
      getText: () => content,
      getWordRangeAtPosition: jest.fn(),
    });
    jest.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      createFakePartial<vscode.TextDocument>({
        uri: vscode.Uri.file(path.join(worktree, 'main.ts')),
        getText: () => content,
        isDirty: false,
      }),
    );
    jest
      .mocked(vscode.window.withProgress)
      .mockImplementation((options, task) =>
        task(createFakePartial<vscode.Progress<unknown>>({ report: jest.fn() }), token),
      );
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    setFolders(true);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('does not resolve a historical commit comparison using the MR head workspace', async () => {
    document = { ...document, uri: toReviewUri({ ...params, comparison: 'commit' }) };
    expect(await navigation.provideDefinition(document, position, token)).toBeUndefined();
    expect(await navigation.provideHover(document, position, token)).toBeUndefined();
    expect(manager.ensure).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  describe('hover documentation', () => {
    const range = new vscode.Range(1, 0, 1, 5);
    let local: vscode.TextDocument;

    beforeEach(() => {
      local = createFakePartial<vscode.TextDocument>({
        uri: vscode.Uri.file(path.join(worktree, 'main.ts')),
        getText: () => content,
        isDirty: false,
        version: 1,
      });
      jest.mocked(vscode.workspace.openTextDocument).mockResolvedValue(local);
      jest.mocked(document.getWordRangeAtPosition).mockReturnValue(range);
      jest
        .mocked(vscode.commands.executeCommand)
        .mockResolvedValue([
          { contents: [new vscode.MarkdownString('```ts\nfunction added(): number\n```')], range },
          { contents: [new vscode.MarkdownString('MR-only documentation')] },
        ]);
    });

    it('returns signature and documentation from the exact MR snapshot without opening editors', async () => {
      const hover = await navigation.provideHover(document, position, token);
      expect(
        hover?.contents.map(entry => (typeof entry === 'string' ? entry : entry.value)),
      ).toEqual(['```ts\nfunction added(): number\n```', 'MR-only documentation']);
      expect(hover?.range).toEqual(range);
      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeHoverProvider',
        local.uri,
        position,
      );
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('never prepares or prompts for a snapshot on mouse hover', async () => {
      setFolders(false);
      expect(await navigation.provideHover(document, position, token)).toBeUndefined();
      expect(manager.ensure).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it.each(['base', 'cancelled', 'untrusted', 'mismatch'])('skips %s documents', async reason => {
      if (reason === 'base')
        document = { ...document, uri: toReviewUri({ ...params, side: 'base' }) };
      if (reason === 'untrusted')
        Object.defineProperty(vscode.workspace, 'isTrusted', { value: false });
      if (reason === 'mismatch') local.getText = () => 'wrong revision';
      const cancellation =
        reason === 'cancelled'
          ? createFakePartial<vscode.CancellationToken>({ isCancellationRequested: true })
          : token;
      expect(await navigation.provideHover(document, position, cancellation)).toBeUndefined();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it.each(['dirty', 'local-version', 'review-version', 'cancelled', 'trust'])(
      'discards results after %s changes',
      async reason => {
        const cancellation = { ...token, isCancellationRequested: false };
        jest.mocked(vscode.commands.executeCommand).mockImplementation(async () => {
          if (reason === 'dirty') Object.defineProperty(local, 'isDirty', { value: true });
          if (reason === 'local-version') Object.defineProperty(local, 'version', { value: 2 });
          if (reason === 'review-version') Object.defineProperty(document, 'version', { value: 2 });
          if (reason === 'cancelled') cancellation.isCancellationRequested = true;
          if (reason === 'trust')
            Object.defineProperty(vscode.workspace, 'isTrusted', { value: false });
          return [{ contents: [new vscode.MarkdownString('stale documentation')] }];
        });
        expect(await navigation.provideHover(document, position, cancellation)).toBeUndefined();
      },
    );

    it('uses the source word range when providers omit ranges and disables command trust', async () => {
      const markdown = new vscode.MarkdownString('[unsafe](command:example)');
      markdown.isTrusted = true;
      jest.mocked(vscode.commands.executeCommand).mockResolvedValue([{ contents: [markdown] }]);
      const hover = await navigation.provideHover(document, position, token);
      expect(hover?.range).toEqual(range);
      expect((hover?.contents[0] as vscode.MarkdownString).isTrusted).toBe(false);
      expect(markdown.isTrusted).toBe(true);
    });

    it.each([undefined, [], [{ contents: [] }]])(
      'ignores empty hover results %j',
      async results => {
        jest.mocked(vscode.commands.executeCommand).mockResolvedValue(results);
        expect(await navigation.provideHover(document, position, token)).toBeUndefined();
      },
    );

    it('preserves legacy plain and language-tagged hover contents', async () => {
      const contents = ['Documentation', { language: 'go', value: 'func added() int' }];
      jest.mocked(vscode.commands.executeCommand).mockResolvedValue([{ contents }]);
      expect((await navigation.provideHover(document, position, token))?.contents).toEqual(
        contents,
      );
    });

    it('does not recreate a missing snapshot still listed in the workspace', async () => {
      jest.mocked(manager.getPrepared).mockResolvedValue(undefined);
      expect(await navigation.provideHover(document, position, token)).toBeUndefined();
      expect(manager.ensure).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('does not show notifications when language analysis fails during passive hover', async () => {
      jest
        .mocked(vscode.commands.executeCommand)
        .mockRejectedValue(new Error('language server starting'));
      expect(await navigation.provideHover(document, position, token)).toBeUndefined();
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
  });

  it('delegates the exact new-side position to the language provider in the MR snapshot', async () => {
    const definition = {
      targetUri: vscode.Uri.file(path.join(worktree, 'added.ts')),
      targetRange: new vscode.Range(position, position),
      targetSelectionRange: new vscode.Range(position, position),
    };
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([definition]);
    expect(await navigation.provideDefinition(document, position, token)).toEqual([
      {
        ...definition,
        targetUri: toReviewUri({ ...params, path: '/added.ts', changeType: 'modified' }),
      },
    ]);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.executeDefinitionProvider',
      vscode.Uri.file(path.join(worktree, 'main.ts')),
      position,
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('converts Location results to definition links without losing the target range', async () => {
    const range = new vscode.Range(new vscode.Position(0, 13), new vscode.Position(0, 18));
    const uri = vscode.Uri.file(path.join(worktree, 'added.ts'));
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([{ uri, range }]);
    expect(await navigation.provideDefinition(document, position, token)).toEqual([
      {
        targetUri: toReviewUri({ ...params, path: '/added.ts', changeType: 'modified' }),
        targetRange: range,
        targetSelectionRange: range,
        originSelectionRange: undefined,
      },
    ]);
  });

  it('preserves the MR identity when navigating to another repository file', async () => {
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
      {
        uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
        range: new vscode.Range(position, position),
      },
    ]);
    const targets = await navigation.provideDefinition(document, position, token);
    expect(fromReviewUri(targets![0].targetUri)).toEqual({
      ...fromReviewUri(document.uri),
      path: '/added.ts',
      changeType: 'modified',
    });
  });

  it('leaves definitions outside the snapshot in their original document', async () => {
    const definition = {
      targetUri: vscode.Uri.file(path.join(directory, 'dependency.ts')),
      targetRange: new vscode.Range(position, position),
      targetSelectionRange: new vscode.Range(position, position),
    };
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([definition]);
    expect(await navigation.provideDefinition(document, position, token)).toEqual([definition]);
  });

  it('delegates Go to Implementation to the exact MR snapshot and maps concrete method locations', async () => {
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
      {
        uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
        range: new vscode.Range(position, position),
      },
    ]);
    const targets = await navigation.provideImplementation(document, position, token);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.executeImplementationProvider',
      vscode.Uri.file(path.join(worktree, 'main.ts')),
      position,
    );
    expect(fromReviewUri(targets![0].targetUri)).toMatchObject({
      mrId: request.mrId,
      projectId: request.projectId,
      commit: request.commit,
      path: '/added.ts',
      side: 'head',
    });
  });

  it('does not map ignored or generated dependencies to nonexistent review files', async () => {
    jest.mocked(manager.hasFile).mockResolvedValue(false);
    const definition = {
      uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
      range: new vscode.Range(position, position),
    };
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([definition]);
    expect((await navigation.provideDefinition(document, position, token))![0].targetUri).toEqual(
      definition.uri,
    );
  });

  it('refuses a definition document with unsaved edits instead of displaying mismatched review lines', async () => {
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
      {
        uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
        range: new vscode.Range(position, position),
      },
    ]);
    jest
      .mocked(vscode.workspace.openTextDocument)
      .mockResolvedValueOnce(
        createFakePartial<vscode.TextDocument>({
          uri: vscode.Uri.file(path.join(worktree, 'main.ts')),
          getText: () => content,
          isDirty: false,
        }),
      )
      .mockResolvedValueOnce(createFakePartial<vscode.TextDocument>({ isDirty: true }));
    expect(await navigation.provideDefinition(document, position, token)).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('local edits'),
    );
  });

  it('uses the changed file type so added and renamed definitions share the sidebar comment URI', async () => {
    navigation = new ReviewNavigation(
      manager,
      () => request,
      () => ({
        ...mrVersion,
        diffs: [{ ...mrVersion.diffs[0], new_path: 'added.ts', new_file: true }],
      }),
    );
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
      {
        uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
        range: new vscode.Range(position, position),
      },
    ]);
    expect((await navigation.provideDefinition(document, position, token))![0].targetUri).toEqual(
      toReviewUri({ ...params, path: '/added.ts', changeType: 'added' }),
    );
  });

  it('does not prepare or query language services for old-side or empty documents', async () => {
    await Promise.all(
      [{ side: 'base' as const }, { exists: false }].map(async override => {
        const source = { ...document, uri: toReviewUri({ ...params, ...override }) };
        expect(await navigation.provideDefinition(source, position, token)).toBeUndefined();
      }),
    );
    expect(manager.ensure).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  describe('opening definition diffs', () => {
    let activate: (editor: vscode.TextEditor | undefined) => unknown;
    let select: (event: vscode.TextEditorSelectionChangeEvent) => unknown;
    let listener: vscode.Disposable;
    let targetEditor: vscode.TextEditor;
    let version: RestMrVersion;
    let baseFileUri: vscode.Uri;
    let headFileUri: vscode.Uri;

    beforeEach(async () => {
      version = {
        ...mrVersion,
        head_commit_sha: request.commit,
        diffs: [
          {
            ...mrVersion.diffs[0],
            old_path: 'old.ts',
            new_path: 'added.ts',
            renamed_file: true,
            new_file: false,
          },
        ],
      };
      navigation = new ReviewNavigation(
        manager,
        () => request,
        () => version,
      );
      ({ baseFileUri, headFileUri } = getBaseAndHeadUri(
        { id: request.mrId, project_id: request.projectId },
        version,
        version.diffs[0],
        request.repositoryRoot,
      ));
      jest.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(callback => {
        activate = callback;
        return new vscode.Disposable(() => {});
      });
      jest.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(callback => {
        select = callback;
        return new vscode.Disposable(() => {});
      });
      listener = navigation.listen();
      jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
        {
          uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
          range: new vscode.Range(position, position),
        },
        {
          uri: vscode.Uri.file(path.join(directory, 'dependency.ts')),
          range: new vscode.Range(position, position),
        },
      ]);
      const targets = await navigation.provideDefinition(document, position, token);
      expect(targets).toHaveLength(2);
      targetEditor = createFakePartial<vscode.TextEditor>({
        document: createFakePartial<vscode.TextDocument>({ uri: targets![0].targetUri }),
        viewColumn: vscode.ViewColumn.One,
        selection: new vscode.Selection(position, position),
      });
      Object.defineProperty(vscode.window, 'activeTextEditor', {
        configurable: true,
        value: targetEditor,
      });
      Object.defineProperty(vscode.window.tabGroups, 'activeTabGroup', {
        configurable: true,
        value: {},
      });
    });

    afterEach(() => listener.dispose());

    it('does not open editors merely when a language service is queried', () => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('opens the matching MR diff at the definition and consumes the target before editor events repeat', async () => {
      await activate(targetEditor);
      await activate(targetEditor);
      await select(
        createFakePartial<vscode.TextEditorSelectionChangeEvent>({ textEditor: targetEditor }),
      );
      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
      expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
        'vscode.diff',
        baseFileUri,
        headFileUri,
        'added.ts (!7)',
        {
          viewColumn: vscode.ViewColumn.One,
          preview: true,
          selection: new vscode.Range(position, position),
        },
      );
      expect(fromReviewUri(baseFileUri)).toMatchObject({
        commit: version.base_commit_sha,
        side: 'base',
        exists: true,
      });
      expect(fromReviewUri(headFileUri)).toMatchObject({
        commit: request.commit,
        side: 'head',
        changeType: 'renamed',
      });
    });

    it('handles selection-only navigation when the target editor is already active', async () => {
      await select(
        createFakePartial<vscode.TextEditorSelectionChangeEvent>({ textEditor: targetEditor }),
      );
      expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
        'vscode.diff',
        baseFileUri,
        headFileUri,
        'added.ts (!7)',
        expect.anything(),
      );
    });

    it('preserves the selected implementation when several candidates are in the same file', async () => {
      const other = new vscode.Position(5, 3);
      jest.mocked(vscode.commands.executeCommand).mockResolvedValue([
        {
          uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
          range: new vscode.Range(position, position),
        },
        {
          uri: vscode.Uri.file(path.join(worktree, 'added.ts')),
          range: new vscode.Range(other, other),
        },
      ]);
      await navigation.provideImplementation(document, position, token);
      await activate(targetEditor);
      expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
        'vscode.diff',
        baseFileUri,
        headFileUri,
        'added.ts (!7)',
        expect.objectContaining({ selection: new vscode.Range(position, position) }),
      );
    });

    it('does not reopen a target already displayed in the correct MR diff', async () => {
      const input = new vscode.TabInputTextDiff(baseFileUri, targetEditor.document.uri);
      Object.defineProperty(vscode.window.tabGroups, 'activeTabGroup', {
        configurable: true,
        value: { activeTab: { input } },
      });
      await activate(targetEditor);
      expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('ignores background editor events and expired navigation results', async () => {
      await activate(createFakePartial<vscode.TextEditor>({ document }));
      const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
      try {
        await activate(targetEditor);
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
      } finally {
        clock.mockRestore();
      }
    });
  });

  it('requires consent before creating or adding a worktree, and does not repeatedly prompt after declining', async () => {
    setFolders(false);
    jest.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    await navigation.provideDefinition(document, position, token);
    await navigation.provideDefinition(document, position, token);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(manager.ensure).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('does not create snapshots in an untrusted workspace or for cancelled requests', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: false });
    expect(await navigation.provideDefinition(document, position, token)).toBeUndefined();
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: true });
    expect(
      await navigation.provideDefinition(document, position, {
        ...token,
        isCancellationRequested: true,
      }),
    ).toBeUndefined();
    expect(manager.ensure).not.toHaveBeenCalled();
  });

  it('prepares once after consent and serializes concurrent navigation requests', async () => {
    acceptPreparation();
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([]);
    await Promise.all([
      navigation.provideDefinition(document, position, token),
      navigation.provideDefinition(document, position, token),
    ]);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(manager.ensure).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
  });

  it('reattaches a previously prepared snapshot without prompting or creating a new worktree', async () => {
    acceptPreparation();
    jest.mocked(manager.findPrepared).mockResolvedValue(request);
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([]);
    await navigation.provideDefinition(document, position, token);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(manager.ensure).not.toHaveBeenCalled();
    expect(manager.getPrepared).toHaveBeenCalledWith(request);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledTimes(1);
  });

  it('automatically prepares an explicitly selected MR without a confirmation dialog', async () => {
    acceptPreparation();
    await navigation.prepareReview(request);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(manager.ensure).toHaveBeenCalledWith(request);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledTimes(1);
  });

  it('does not automatically prepare selected MRs in an untrusted workspace', async () => {
    Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: false });
    await navigation.prepareReview(request);
    expect(manager.ensure).not.toHaveBeenCalled();
    expect(vscode.workspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('completes explicitly consented preparation even if clicking the notification cancels F12', async () => {
    acceptPreparation();
    const cancelledByClick = { ...token, isCancellationRequested: false };
    jest.mocked(vscode.window.showInformationMessage).mockImplementation(async () => {
      cancelledByClick.isCancellationRequested = true;
      return 'Prepare Review Workspace' as never;
    });
    await navigation.provideDefinition(document, position, cancelledByClick);
    expect(manager.ensure).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.updateWorkspaceFolders).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('does not invoke language tools if adding the folder makes the workspace untrusted', async () => {
    acceptPreparation();
    const update = jest.mocked(vscode.workspace.updateWorkspaceFolders).getMockImplementation();
    if (!update) throw new Error('Missing workspace update test implementation');
    jest.mocked(vscode.workspace.updateWorkspaceFolders).mockImplementation((...args) => {
      const result = update(...args);
      Object.defineProperty(vscode.workspace, 'isTrusted', { configurable: true, value: false });
      return result;
    });
    await navigation.provideDefinition(document, position, token);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('drops a language-service result if its source changed during the request', async () => {
    const local = createFakePartial<vscode.TextDocument>({
      uri: vscode.Uri.file(path.join(worktree, 'main.ts')),
      getText: () => content,
      isDirty: false,
      version: 1,
    });
    jest.mocked(vscode.workspace.openTextDocument).mockResolvedValue(local);
    jest.mocked(vscode.commands.executeCommand).mockImplementation(async () => {
      Object.defineProperty(local, 'version', { value: 2 });
      return [];
    });
    expect(await navigation.provideDefinition(document, position, token)).toBeUndefined();
  });

  it('refuses mismatched snapshot content instead of jumping to the wrong line', async () => {
    jest.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
      createFakePartial<vscode.TextDocument>({
        uri: vscode.Uri.file(path.join(worktree, 'main.ts')),
        getText: () => 'different code',
        isDirty: false,
      }),
    );
    await navigation.provideDefinition(document, position, token);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('rejects traversal and symlinks outside the snapshot', async () => {
    await Promise.all(
      ['/../secret.ts', '/C:/secret.ts', '/folder\\secret.ts'].map(filePath =>
        navigation.provideDefinition(
          { ...document, uri: toReviewUri({ ...params, path: filePath }) },
          position,
          token,
        ),
      ),
    );
    await fs.writeFile(path.join(directory, 'outside.ts'), content);
    await fs.symlink(path.join(directory, 'outside.ts'), path.join(worktree, 'linked.ts'));
    await navigation.provideDefinition(
      { ...document, uri: toReviewUri({ ...params, path: '/linked.ts' }) },
      position,
      token,
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('opens added files in the exact snapshot and preserves the diff cursor position', async () => {
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      configurable: true,
      value: { document, selection: { active: position } },
    });
    await navigation.openFile(document.uri);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ uri: vscode.Uri.file(path.join(worktree, 'main.ts')) }),
      expect.objectContaining({ selection: new vscode.Range(position, position) }),
    );
  });

  it('restores a previously prepared head after the extension cache is reset', async () => {
    navigation = new ReviewNavigation(manager, () => undefined);
    jest.mocked(manager.findPrepared).mockResolvedValue(request);
    jest.mocked(vscode.commands.executeCommand).mockResolvedValue([]);
    await navigation.provideDefinition(document, position, token);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.executeDefinitionProvider',
      expect.anything(),
      position,
    );
  });
});

describe('getReviewNavigationRequest', () => {
  beforeEach(() => {
    jest.mocked(getProjectRepository).mockReturnValue(
      createFakePartial<ReturnType<typeof getProjectRepository>>({
        getProjectOrFail: () => projectInRepository,
      }),
    );
    jest.mocked(mrCache.getMr).mockReturnValue({ mr, mrVersion });
  });

  it('uses the target project remote and MR IID rather than the global MR ID for fetches', () => {
    expect(
      getReviewNavigationRequest({
        repositoryRoot: '/repo',
        projectId: mr.project_id,
        mrId: mr.id,
        commit: mrVersion.head_commit_sha,
      }),
    ).toEqual({
      repositoryRoot: '/repo',
      projectId: mr.project_id,
      mrId: mr.id,
      mrIid: mr.iid,
      remoteName: projectInRepository.pointer.remote.name,
      commit: mrVersion.head_commit_sha,
    });
  });

  it('does not substitute the latest head for an old-side or stale commit', () => {
    expect(
      getReviewNavigationRequest({
        repositoryRoot: '/repo',
        projectId: mr.project_id,
        mrId: mr.id,
        commit: mrVersion.base_commit_sha,
      }),
    ).toBeUndefined();
  });
});
