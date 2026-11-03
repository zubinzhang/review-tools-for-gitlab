import { createFakeFetchFromApi } from '../../common/test_utils/create_fake_fetch_from_api';
import { project } from '../../common/test_utils/entities';
import { mr, pipeline } from '../test_utils/entities';
import { getMergeRequestsForBranch } from './api/get_merge_requests_for_branch';
import { getPipelinesForMr } from './api/get_pipelines_for_mr';
import { getPipelinesForRef } from './api/get_pipelines_for_ref';
import { getPipelineAndMrForBranch } from './get_pipeline_and_mr_for_branch';
import { GitLabService } from './gitlab_service';

describe('getPipelineAndMrForBranch', () => {
  describe('when branch has an associated merge request', () => {
    it('returns MR pipeline with largest iid', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'branch-name';

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [mr] },
          {
            request: getPipelinesForMr(mr),
            response: [
              { ...pipeline, iid: 4 },
              { ...pipeline, iid: 5 },
            ],
          },
          {
            request: getPipelinesForRef(project, branchName),
            response: [{ ...pipeline, iid: 1 }],
          },
        ),
      );

      const { pipeline: p } = await getPipelineAndMrForBranch(fakeService, project, branchName);

      expect(p?.iid).toBe(5);
    });

    it('returns branch pipeline if MR pipeline is outdated', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'branch-name';

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [mr] },
          {
            request: getPipelinesForMr(mr),
            response: [{ ...pipeline, iid: 2 }],
          },
          {
            request: getPipelinesForRef(project, branchName),
            response: [{ ...pipeline, iid: 3 }],
          },
        ),
      );

      const { pipeline: p } = await getPipelineAndMrForBranch(fakeService, project, branchName);

      expect(p?.iid).toBe(3);
    });
  });

  describe('when branch does not have an associated merge request', () => {
    it('returns no MR and latest pipeline for a branch', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'branch-name';

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [] },
          {
            request: getPipelinesForRef(project, branchName),
            response: [
              { ...pipeline, iid: 1 },
              { ...pipeline, iid: 2 },
            ],
          },
        ),
      );

      const {
        pipeline: p,
        mr: m,
        isTagPipeline,
      } = await getPipelineAndMrForBranch(fakeService, project, branchName);

      expect(m).toBeUndefined();
      expect(p?.iid).toBe(2);
      expect(isTagPipeline).toBe(false);
    });
  });

  describe('when commit has tags', () => {
    it('returns tag pipeline when only tag pipeline exists', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'main';
      const tags = ['v1.0.0'];

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [] },
          {
            request: getPipelinesForRef(project, branchName),
            response: [],
          },
          {
            request: getPipelinesForRef(project, 'v1.0.0'),
            response: [{ ...pipeline, id: 99, iid: 12, ref: 'v1.0.0' }],
          },
        ),
      );

      const {
        pipeline: p,
        mr: m,
        isTagPipeline,
      } = await getPipelineAndMrForBranch(fakeService, project, branchName, tags);

      expect(m).toBeUndefined();
      expect(p?.iid).toBe(12);
      expect(p?.ref).toBe('v1.0.0');
      expect(isTagPipeline).toBe(true);
    });

    it('returns tag pipeline if tag pipeline is newer than branch pipeline', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'main';
      const tags = ['v1.1.0'];

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [] },
          {
            request: getPipelinesForRef(project, branchName),
            response: [{ ...pipeline, id: 50, iid: 5 }],
          },
          {
            request: getPipelinesForRef(project, 'v1.1.0'),
            response: [{ ...pipeline, id: 60, iid: 6, ref: 'v1.1.0' }],
          },
        ),
      );

      const { pipeline: p, isTagPipeline } = await getPipelineAndMrForBranch(
        fakeService,
        project,
        branchName,
        tags,
      );

      expect(p?.iid).toBe(6);
      expect(isTagPipeline).toBe(true);
    });

    it('returns branch pipeline if branch pipeline is newer than tag pipeline', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'main';
      const tags = ['v1.0.0'];

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [] },
          {
            request: getPipelinesForRef(project, branchName),
            response: [{ ...pipeline, id: 70, iid: 7 }],
          },
          {
            request: getPipelinesForRef(project, 'v1.0.0'),
            response: [{ ...pipeline, id: 60, iid: 6, ref: 'v1.0.0' }],
          },
        ),
      );

      const { pipeline: p, isTagPipeline } = await getPipelineAndMrForBranch(
        fakeService,
        project,
        branchName,
        tags,
      );

      expect(p?.iid).toBe(7);
      expect(isTagPipeline).toBe(false);
    });

    it('prioritizes MR pipeline over tag pipeline even if tag pipeline is newer', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'feature';
      const tags = ['v2.0.0-rc1'];

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [mr] },
          {
            request: getPipelinesForMr(mr),
            response: [{ ...pipeline, id: 11, iid: 2 }],
          },
          {
            request: getPipelinesForRef(project, branchName),
            response: [{ ...pipeline, id: 10, iid: 1 }],
          },
          {
            request: getPipelinesForRef(project, 'v2.0.0-rc1'),
            response: [{ ...pipeline, id: 12, iid: 3, ref: 'v2.0.0-rc1' }],
          },
        ),
      );

      const {
        pipeline: p,
        mr: m,
        isTagPipeline,
      } = await getPipelineAndMrForBranch(fakeService, project, branchName, tags);

      expect(m?.id).toBe(mr.id);
      expect(p?.iid).toBe(2);
      expect(isTagPipeline).toBe(false);
    });

    it('returns tag pipeline when MR has no pipeline and tag pipeline exists', async () => {
      const fakeService = new GitLabService({ instanceUrl: '', token: '' });
      const branchName = 'feature';
      const tags = ['v2.0.0-rc1'];

      jest.spyOn(fakeService, 'fetchFromApi').mockImplementation(
        createFakeFetchFromApi(
          { request: getMergeRequestsForBranch(project, branchName), response: [mr] },
          {
            request: getPipelinesForMr(mr),
            response: [],
          },
          {
            request: getPipelinesForRef(project, branchName),
            response: [],
          },
          {
            request: getPipelinesForRef(project, 'v2.0.0-rc1'),
            response: [{ ...pipeline, id: 12, iid: 3, ref: 'v2.0.0-rc1' }],
          },
        ),
      );

      const {
        pipeline: p,
        mr: m,
        isTagPipeline,
      } = await getPipelineAndMrForBranch(fakeService, project, branchName, tags);

      expect(m?.id).toBe(mr.id);
      expect(p?.iid).toBe(3);
      expect(isTagPipeline).toBe(true);
    });
  });
});
