import path from 'path';
import * as vscode from 'vscode';
import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { GitRepository } from '../git/new_git';
import { ProjectInRepository } from '../gitlab/new_project';

import * as testEntities from '../test_utils/entities';
import { createFakeRepository } from '../test_utils/fake_git_extension';
import { Repository } from '../api/git';
import { DetachedHeadError } from '../errors/detached_head_error';
import { WarningError } from '../errors/warning_error';
import { VS_COMMANDS } from '../../common/command_names';
import {
  copyLinkToActiveFile,
  copyLinkToActiveFileOnBranch,
  openActiveFile,
  openCommitInGitLab,
} from './openers';

const TEST_HASH = 'abcdefg';
const repoRootPath = path.join('path', 'to', 'repo');

describe('openers', () => {
  let rawRepository: Repository;
  let activeEditor: vscode.TextEditor;
  let pir: ProjectInRepository;

  beforeEach(() => {
    rawRepository = createFakeRepository({ headName: 'local-branch' });
    pir = {
      ...testEntities.projectInRepository,
      pointer: {
        ...testEntities.projectInRepository.pointer,
        repository: {
          rootFsPath: repoRootPath,
          rawRepository,
        } as GitRepository,
      },
    };
    activeEditor = createFakePartial<vscode.TextEditor>({
      document: { uri: vscode.Uri.file(path.join(repoRootPath, 'file')) },
      selection: {
        start: { line: 1 },
        end: { line: 2 },
      },
    });
  });

  describe('openCommitInGitLab', () => {
    it('uses project and commit', async () => {
      await openCommitInGitLab('https://gitlab.com/gitlab-org/gitlab-vscode-extension', TEST_HASH);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        VS_COMMANDS.OPEN,
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/commit/${TEST_HASH}`,
      );
    });
  });

  describe('openActiveFile', () => {
    it('opens permalink URL in browser when active file is versioned', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];

      await openActiveFile({ projectInRepository: pir, activeEditor });

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        VS_COMMANDS.OPEN,
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/${TEST_HASH}/file#L2-3`,
      );
    });

    it('shows error when active file is not versioned', async () => {
      rawRepository.log = async () => [];

      const openResult = openActiveFile({ projectInRepository: pir, activeEditor });

      await expect(openResult).rejects.toThrow(WarningError);
      await expect(openResult).rejects.toThrow(/No link exists for the current file/);

      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('throws error when the file is not in the project repository', async () => {
      activeEditor = createFakePartial<vscode.TextEditor>({
        document: { uri: vscode.Uri.file('Untitled-1') },
      });

      const openResult = openActiveFile({ projectInRepository: pir, activeEditor });

      await expect(openResult).rejects.toThrow(WarningError);
      await expect(openResult).rejects.toThrow(/current file is not in the project repository/);

      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
  });

  describe('copyLinkToActiveFile', () => {
    it('creates permalink when active file is versioned', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];

      await copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/${TEST_HASH}/file#L2-3`,
      );
    });

    it('creates permalink with single-line selection', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];
      activeEditor = createFakePartial<vscode.TextEditor>({
        ...activeEditor,
        selection: {
          start: { line: 1 },
          end: { line: 1 },
        },
      });

      await copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/${TEST_HASH}/file#L2`,
      );
    });

    it('creates permalink without line anchor when there is no selection', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];
      activeEditor = createFakePartial<vscode.TextEditor>({
        ...activeEditor,
        selection: undefined,
      });

      await copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/${TEST_HASH}/file`,
      );
    });

    it('handles files in subdirectories with forward slashes', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];
      activeEditor = createFakePartial<vscode.TextEditor>({
        ...activeEditor,
        document: { uri: vscode.Uri.file(path.join(repoRootPath, 'nested', 'path', 'file.ts')) },
      });

      await copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        `https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/${TEST_HASH}/nested/path/file.ts#L2-3`,
      );
    });

    it('shows error when active file is not versioned', async () => {
      rawRepository.log = async () => [];

      const copyResult = copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      await expect(copyResult).rejects.toThrow(WarningError);
      await expect(copyResult).rejects.toThrow(/No link exists for the current file/);

      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('throws error when the file is not in the project repository', async () => {
      activeEditor = createFakePartial<vscode.TextEditor>({
        document: { uri: vscode.Uri.file('Untitled-1') },
      });

      const copyResult = copyLinkToActiveFile({ projectInRepository: pir, activeEditor });

      await expect(copyResult).rejects.toThrow(WarningError);
      await expect(copyResult).rejects.toThrow(/current file is not in the project repository/);

      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('copyLinkToActiveFileOnBranch', () => {
    it('copies link with remote tracking branch when upstream is configured', async () => {
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];
      rawRepository.getConfig = async () => 'refs/heads/remote-branch';

      await copyLinkToActiveFileOnBranch({ projectInRepository: pir, activeEditor });

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/blob/remote-branch/file#L2-3',
      );
    });

    it('throws DetachedHeadError when HEAD is detached', async () => {
      rawRepository = createFakeRepository();
      rawRepository.log = async () => [{ hash: TEST_HASH, message: '', parents: [] }];
      pir = {
        ...pir,
        pointer: {
          ...pir.pointer,
          repository: {
            rootFsPath: repoRootPath,
            rawRepository,
          } as GitRepository,
        },
      };

      const copyResult = copyLinkToActiveFileOnBranch({ projectInRepository: pir, activeEditor });

      await expect(copyResult).rejects.toThrow(DetachedHeadError);
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });
  });
});
