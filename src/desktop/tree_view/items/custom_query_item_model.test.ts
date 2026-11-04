import * as vscode from 'vscode';
import { customQuery, mr, projectInRepository } from '../../test_utils/entities';
import { createFakePartial } from '../../../common/test_utils/create_fake_partial';
import { getGitLabService } from '../../gitlab/get_gitlab_service';
import { GitLabService } from '../../gitlab/gitlab_service';
import { CustomQueryType } from '../../../common/gitlab/custom_query_type';

import { CustomQueryItemModel } from './custom_query_item_model';

jest.mock('../../gitlab/get_gitlab_service');

describe('CustomQueryItem', () => {
  let item: vscode.TreeItem;

  it('reuses unchanged MR models and replaces changed MR metadata', async () => {
    const fetch = jest.fn().mockResolvedValue([{ ...mr }]);
    jest
      .mocked(getGitLabService)
      .mockReturnValue(createFakePartial<GitLabService>({ getIssuables: fetch }));
    const model = new CustomQueryItemModel(
      { ...customQuery, type: CustomQueryType.MR },
      projectInRepository,
    );
    const [first] = await model.getChildren();
    expect((await model.getChildren())[0]).toBe(first);
    fetch.mockResolvedValue([{ ...mr, title: 'Updated MR' }]);
    expect((await model.getChildren())[0]).not.toBe(first);
  });

  describe('item labeled as a query', () => {
    beforeEach(() => {
      item = new CustomQueryItemModel(customQuery, projectInRepository).getTreeItem();
    });

    it('should have query name as label', () => {
      expect(item.label).toBe('Query name');
    });

    it('should have filter icon', () => {
      expect(item.iconPath).toEqual(new vscode.ThemeIcon('filter'));
    });
  });
});
