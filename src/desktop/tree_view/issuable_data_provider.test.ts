import { createFakePartial } from '../../common/test_utils/create_fake_partial';
import { ExtensionState } from '../extension_state';
import { gitExtensionWrapper } from '../git/git_extension_wrapper';
import { getProjectRepository, GitLabProjectRepository } from '../gitlab/gitlab_project_repository';
import { gitRepository } from '../test_utils/entities';
import { IssuableDataProvider } from './issuable_data_provider';
import { ItemModel } from './items/item_model';

jest.mock('../gitlab/gitlab_project_repository');

describe('Issuable Data Provider', () => {
  let provider: IssuableDataProvider;
  beforeEach(() => {
    jest.mocked(getProjectRepository).mockReturnValue(
      createFakePartial<GitLabProjectRepository>({
        onProjectChange: jest.fn(),
      }),
    );
    provider = new IssuableDataProvider(
      createFakePartial<ExtensionState>({ isValid: () => true, onDidChangeValid: jest.fn() }),
    );
  });

  it('returns empty array when there are no repositories', async () => {
    jest.spyOn(gitExtensionWrapper, 'gitRepositories', 'get').mockReturnValue([]);
    expect(await provider.getChildren(undefined)).toEqual([]);
  });

  it('can exclude review snapshots so adding one does not duplicate the MR project tree', async () => {
    jest.spyOn(gitExtensionWrapper, 'gitRepositories', 'get').mockReturnValue([gitRepository]);
    const includeRepository = jest.fn().mockReturnValue(false);
    provider = new IssuableDataProvider(
      createFakePartial<ExtensionState>({ isValid: () => true, onDidChangeValid: jest.fn() }),
      includeRepository,
    );
    expect(await provider.getChildren(undefined)).toEqual([]);
    expect(includeRepository).toHaveBeenCalledWith(gitRepository, 0, [gitRepository]);
  });

  it('returns an error item if the repository does not contain GitLab project', async () => {
    jest.spyOn(gitExtensionWrapper, 'gitRepositories', 'get').mockReturnValue([gitRepository]);
    jest.mocked(getProjectRepository).mockReturnValue(
      createFakePartial<GitLabProjectRepository>({
        getSelectedOrDefaultForRepository: jest.fn().mockReturnValue(undefined),
        repositoryHasAmbiguousProjects: jest.fn().mockReturnValue(false),
        onProjectChange: jest.fn(),
      }),
    );
    const children = await provider.getChildren(undefined);
    const firstChild = children[0];
    expect(children.length).toBe(1);
    if (firstChild instanceof ItemModel) {
      throw new Error('firstChild should not be an ItemModel');
    }
    expect(firstChild.label).toMatch(/no GitLab project/);
  });

  it('does not display a repository twice when Git reports the same root more than once', async () => {
    jest
      .spyOn(gitExtensionWrapper, 'gitRepositories', 'get')
      .mockReturnValue([gitRepository, gitRepository]);
    jest.mocked(getProjectRepository).mockReturnValue(
      createFakePartial<GitLabProjectRepository>({
        getSelectedOrDefaultForRepository: jest.fn().mockReturnValue(undefined),
        repositoryHasAmbiguousProjects: jest.fn().mockReturnValue(false),
        onProjectChange: jest.fn(),
      }),
    );
    expect(await provider.getChildren(undefined)).toHaveLength(1);
  });
});
