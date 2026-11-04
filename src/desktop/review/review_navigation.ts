import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getProjectRepository } from '../gitlab/gitlab_project_repository';
import { mrCache } from '../gitlab/mr_cache';
import { REVIEW_URI_SCHEME } from '../constants';
import {
  ChangedFileItem,
  getBaseAndHeadUri,
  getChangeType,
} from '../tree_view/items/changed_file_item';
import { ReviewParams, fromReviewUri, toReviewUri } from './review_uri';
import { ReviewWorktreeManager, ReviewWorktreeRequest } from './review_worktree';
import { ReviewWorkspace } from './review_workspace';

export const PREPARE_REVIEW_NAVIGATION = 'gitlab-review.prepareCodeNavigation';

type NavigationIdentity = Pick<ReviewParams, 'repositoryRoot' | 'projectId' | 'mrId' | 'commit'>;
type NavigationMode = 'implicit' | 'explicit' | 'hover';

interface DefinitionDiff {
  baseFileUri: vscode.Uri;
  headFileUri: vscode.Uri;
  title: string;
  selections: vscode.Range[];
  created: number;
}

export function getReviewNavigationVersion(params: NavigationIdentity): RestMrVersion | undefined {
  try {
    const project = getProjectRepository().getProjectOrFail(params.repositoryRoot);
    const cached = mrCache.getMr(params.mrId, project);
    return cached?.mr.project_id === params.projectId &&
      cached.mrVersion.head_commit_sha === params.commit
      ? cached.mrVersion
      : undefined;
  } catch {
    return undefined;
  }
}

export function getReviewNavigationRequest(
  params: NavigationIdentity,
): ReviewWorktreeRequest | undefined {
  try {
    const project = getProjectRepository().getProjectOrFail(params.repositoryRoot);
    const cached = mrCache.getMr(params.mrId, project);
    if (
      !cached ||
      cached.mr.project_id !== params.projectId ||
      cached.mrVersion.head_commit_sha !== params.commit
    )
      return undefined;
    return {
      repositoryRoot: params.repositoryRoot,
      projectId: params.projectId,
      mrId: params.mrId,
      mrIid: cached.mr.iid,
      commit: cached.mrVersion.head_commit_sha,
      remoteName: project.pointer.remote.name,
    };
  } catch {
    return undefined;
  }
}

export class ReviewNavigation
  implements vscode.DefinitionProvider, vscode.ImplementationProvider, vscode.HoverProvider
{
  #declined = new Set<string>();

  #warnings = new Set<string>();

  #preparing = new Map<string, Promise<string | undefined>>();

  #definitionDiffs = new Map<string, DefinitionDiff>();

  constructor(
    private readonly manager: ReviewWorktreeManager,
    private readonly resolveRequest = getReviewNavigationRequest,
    private readonly resolveVersion = getReviewNavigationVersion,
    private readonly workspace = new ReviewWorkspace(
      manager.storagePath,
      manager.previousStoragePaths,
    ),
  ) {}

  listen(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.window.onDidChangeActiveTextEditor(editor => this.#openDefinitionDiff(editor)),
      vscode.window.onDidChangeTextEditorSelection(event =>
        this.#openDefinitionDiff(event.textEditor),
      ),
      new vscode.Disposable(() => this.#definitionDiffs.clear()),
    );
  }

  async #openDefinitionDiff(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor || editor !== vscode.window.activeTextEditor) return;
    const key = editor.document.uri.toString();
    const target = this.#definitionDiffs.get(key);
    if (!target) return;
    if (Date.now() - target.created > 30000) {
      this.#definitionDiffs.delete(key);
      return;
    }
    const selection =
      target.selections.find(range => range.contains(editor.selection.active)) ??
      (target.selections.length === 1 ? target.selections[0] : undefined);
    if (!selection) return;
    this.#definitionDiffs.delete(key);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (
      input instanceof vscode.TabInputTextDiff &&
      input.modified.toString() === key &&
      input.original.toString() === target.baseFileUri.toString()
    )
      return;
    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        target.baseFileUri,
        target.headFileUri,
        target.title,
        { viewColumn: editor.viewColumn, preview: true, selection },
      );
    } catch (error) {
      this.#warn(editor.document.uri, error);
    }
  }

  #rememberDefinitionDiffs(
    links: vscode.LocationLink[],
    request: ReviewWorktreeRequest,
    scheme: string,
  ): void {
    const version = this.resolveVersion(request);
    if (!version) return;
    const targets = new Map<string, DefinitionDiff>();
    for (const link of links) {
      if (link.targetUri.scheme !== scheme) continue;
      const params = fromReviewUri(link.targetUri);
      if (
        params.mrId !== request.mrId ||
        params.projectId !== request.projectId ||
        params.repositoryRoot !== request.repositoryRoot ||
        params.commit !== request.commit ||
        params.side !== 'head'
      )
        continue;
      const diff = version.diffs.find(
        file => `/${file.new_path}` === params.path && !file.deleted_file,
      );
      if (!diff) continue;
      const { baseFileUri, headFileUri } = getBaseAndHeadUri(
        { id: request.mrId, project_id: request.projectId },
        version,
        diff,
        request.repositoryRoot,
      );
      const key = link.targetUri.toString();
      const existing = targets.get(key);
      if (existing) {
        existing.selections.push(link.targetSelectionRange ?? link.targetRange);
        continue;
      }
      targets.set(key, {
        baseFileUri: baseFileUri.with({ scheme: link.targetUri.scheme }),
        headFileUri: headFileUri.with({ scheme: link.targetUri.scheme }),
        title: `${path.posix.basename(diff.new_path)} (!${request.mrIid})`,
        selections: [link.targetSelectionRange ?? link.targetRange],
        created: Date.now(),
      });
    }
    for (const [key, target] of targets) this.#definitionDiffs.set(key, target);
    while (this.#definitionDiffs.size > 100) {
      const oldest = this.#definitionDiffs.keys().next().value;
      if (oldest === undefined) break;
      this.#definitionDiffs.delete(oldest);
    }
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.LocationLink[] | undefined> {
    return this.#provideNavigation(document, position, token, 'vscode.executeDefinitionProvider');
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    try {
      const reviewVersion = document.version;
      const snapshot = await this.#getLocalDocument(document, token, 'hover');
      if (!snapshot || token.isCancellationRequested) return undefined;
      const local = snapshot.document;
      const localVersion = local.version;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        local.uri,
        position,
      );
      if (
        token.isCancellationRequested ||
        !vscode.workspace.isTrusted ||
        local.isDirty ||
        local.version !== localVersion ||
        document.version !== reviewVersion
      )
        return undefined;
      const contents = (hovers ?? []).flatMap(hover =>
        hover.contents.map(content => {
          if (typeof content === 'string' || 'language' in content) return content;
          const markdown = new vscode.MarkdownString(content.value, content.supportThemeIcons);
          markdown.isTrusted = false;
          markdown.supportHtml = content.supportHtml;
          markdown.baseUri = content.baseUri;
          return markdown;
        }),
      );
      if (!contents.length) return undefined;
      const range = hovers?.find(hover => hover.range?.contains(position))?.range;
      return { contents, range: range ?? document.getWordRangeAtPosition(position) };
    } catch {
      return undefined;
    }
  }

  async provideImplementation(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.LocationLink[] | undefined> {
    return this.#provideNavigation(
      document,
      position,
      token,
      'vscode.executeImplementationProvider',
    );
  }

  async #provideNavigation(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    command: 'vscode.executeDefinitionProvider' | 'vscode.executeImplementationProvider',
  ): Promise<vscode.LocationLink[] | undefined> {
    try {
      const snapshot = await this.#getLocalDocument(document, token);
      if (!snapshot || token.isCancellationRequested) return undefined;
      const local = snapshot.document;
      const { version } = local;
      const definitions = await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >(command, local.uri, position);
      if (token.isCancellationRequested || local.isDirty || local.version !== version)
        return undefined;
      const links = await Promise.all(
        (definitions ?? []).map(async definition => {
          const link =
            'targetUri' in definition
              ? definition
              : {
                  targetUri: definition.uri,
                  targetRange: definition.range,
                  targetSelectionRange: definition.range,
                  originSelectionRange: document.getWordRangeAtPosition(position),
                };
          return {
            ...link,
            targetUri: await this.#reviewTarget(
              link.targetUri,
              document.uri,
              snapshot.root,
              snapshot.request,
            ),
          };
        }),
      );
      if (token.isCancellationRequested || local.isDirty || local.version !== version)
        return undefined;
      this.#rememberDefinitionDiffs(links, snapshot.request, document.uri.scheme);
      return links;
    } catch (error) {
      this.#warn(document.uri, error);
      return undefined;
    }
  }

  async #reviewTarget(
    uri: vscode.Uri,
    source: vscode.Uri,
    root: string,
    request: ReviewWorktreeRequest,
  ): Promise<vscode.Uri> {
    if (uri.scheme !== 'file') return uri;
    const relative = path.relative(root, uri.fsPath);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return uri;
    const realFile = await fs.realpath(uri.fsPath).catch(() => undefined);
    if (!realFile) return uri;
    const containment = path.relative(await fs.realpath(root), realFile);
    if (
      containment === '..' ||
      containment.startsWith(`..${path.sep}`) ||
      path.isAbsolute(containment)
    )
      return uri;
    const filename = relative.split(path.sep).join('/');
    if (!(await this.manager.hasFile(request, filename))) return uri;
    const target = await vscode.workspace.openTextDocument(uri);
    if (target.isDirty)
      throw new Error(
        'The definition file has local edits. Restore the MR snapshot before navigating.',
      );
    const params = fromReviewUri(source);
    const diff = this.resolveVersion(params)?.diffs.find(
      file => file.new_path === filename && !file.deleted_file,
    );
    return toReviewUri({
      ...params,
      path: `/${filename}`,
      exists: true,
      side: 'head',
      changeType: diff ? getChangeType(diff) : 'modified',
    }).with({ scheme: source.scheme });
  }

  async prepare(param?: vscode.Uri | ChangedFileItem): Promise<void> {
    const document = await this.#getSourceDocument(param);
    if (!document) return;
    this.#warnings.delete(document.uri.toString());
    await this.#getLocalDocument(document, undefined, 'explicit');
  }

  async openFile(param?: vscode.Uri | ChangedFileItem): Promise<void> {
    const document = await this.#getSourceDocument(param);
    if (!document) return;
    this.#warnings.delete(document.uri.toString());
    const local = await this.#getLocalDocument(document, undefined, 'explicit');
    if (!local) return;
    const editor = vscode.window.activeTextEditor;
    const position =
      editor?.document.uri.toString() === document.uri.toString()
        ? editor.selection.active
        : undefined;
    await vscode.window.showTextDocument(local.document, {
      preview: true,
      ...(position ? { selection: new vscode.Range(position, position) } : {}),
    });
  }

  async #getSourceDocument(
    param?: vscode.Uri | ChangedFileItem,
  ): Promise<vscode.TextDocument | undefined> {
    const uri =
      param && 'headFileUri' in param
        ? param.headFileUri
        : (param ?? vscode.window.activeTextEditor?.document.uri);
    if (!uri || uri.scheme !== REVIEW_URI_SCHEME) {
      await vscode.window.showInformationMessage(
        'Open the new (right) side of an MR diff to prepare code navigation.',
      );
      return undefined;
    }
    const active = vscode.window.activeTextEditor?.document;
    return active?.uri.toString() === uri.toString()
      ? active
      : vscode.workspace.openTextDocument(uri);
  }

  async #getLocalDocument(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken,
    mode: NavigationMode = 'implicit',
  ): Promise<
    { document: vscode.TextDocument; root: string; request: ReviewWorktreeRequest } | undefined
  > {
    const explicit = mode === 'explicit';
    if (token?.isCancellationRequested) return undefined;
    if (!vscode.workspace.isTrusted) {
      if (explicit)
        await vscode.window.showWarningMessage(
          'Trust this workspace before preparing MR code navigation.',
        );
      return undefined;
    }
    const params = fromReviewUri(document.uri);
    if (!params.exists || !params.commit || params.side === 'base') {
      if (explicit)
        await vscode.window.showInformationMessage(
          'Code navigation is available only on the new (right) side of an MR diff.',
        );
      return undefined;
    }
    const relative = params.path.replace(/^\//, '');
    if (
      !relative ||
      relative.includes('\\') ||
      relative.includes('\0') ||
      /^[A-Za-z]:/.test(relative) ||
      path.isAbsolute(relative) ||
      relative.split('/').includes('..')
    ) {
      throw new Error('Invalid file path in the review document.');
    }
    const request =
      this.resolveRequest(params) ??
      (params.side === 'head'
        ? await this.manager.findPrepared({ ...params, commit: params.commit })
        : undefined);
    if (!request) {
      if (explicit)
        await vscode.window.showInformationMessage(
          'Refresh the MR in the review sidebar and reopen its diff before preparing navigation.',
        );
      return undefined;
    }
    const root = await this.#getRoot(request, mode);
    if (!root || token?.isCancellationRequested || !vscode.workspace.isTrusted) return undefined;
    const filename = path.join(root, relative);
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(filename);
    const containment = path.relative(realRoot, realFile);
    if (
      containment.startsWith(`..${path.sep}`) ||
      containment === '..' ||
      path.isAbsolute(containment) ||
      !(await fs.stat(realFile)).isFile()
    ) {
      throw new Error('The review file resolves outside the MR snapshot.');
    }
    const local = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    if (
      local.isDirty ||
      local.getText().replace(/\r\n/g, '\n') !== document.getText().replace(/\r\n/g, '\n')
    ) {
      throw new Error(
        'The review file does not match the MR snapshot. Restore local edits or refresh the diff before navigating.',
      );
    }
    return { document: local, root, request };
  }

  async #getRoot(
    request: ReviewWorktreeRequest,
    mode: NavigationMode,
  ): Promise<string | undefined> {
    const explicit = mode === 'explicit';
    const root = this.manager.getPath(request);
    const included = () => this.workspace.isIncluded(root);
    if (mode === 'hover') return included() ? this.manager.getPrepared(request) : undefined;
    if (included()) return this.manager.ensure(request);
    if (!explicit && this.#declined.has(root)) return undefined;
    const pending = this.#preparing.get(root);
    if (pending) return pending;
    const preparation = (async () => {
      if (await this.manager.findPrepared(request)) {
        const prepared = await this.manager.getPrepared(request);
        if (prepared)
          return (await this.workspace.include(prepared, request)) ? prepared : undefined;
      }
      const choice = await vscode.window.showInformationMessage(
        `Prepare an isolated worktree for MR !${request.mrIid} (${request.commit.slice(0, 8)}) and add it to this workspace for language analysis? Your current branch and files will not change. Only prepare code you trust: language tools may load project configuration. VS Code may reload extensions the first time; then retry F12.`,
        'Prepare Review Workspace',
      );
      if (choice !== 'Prepare Review Workspace') {
        this.#declined.add(root);
        return undefined;
      }
      const target = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Preparing code navigation for MR !${request.mrIid}`,
        },
        () => this.manager.ensure(request),
      );
      return (await this.workspace.include(target, request)) ? target : undefined;
    })();
    this.#preparing.set(root, preparation);
    try {
      return await preparation;
    } finally {
      this.#preparing.delete(root);
    }
  }

  #warn(uri: vscode.Uri, error: Error): void {
    if (this.#warnings.has(uri.toString())) return;
    this.#warnings.add(uri.toString());
    vscode.window.showWarningMessage(`Review Tools for GitLab: ${error.message}`);
  }
}
