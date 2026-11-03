import { log } from '../../common/log';
import { GitLabProject } from '../../common/platform/gitlab_project';
import { sort } from '../utils/sort';
import { findOpenMrForCurrentBranch } from './utils/mr_lookup_helpers';
import { getPipelinesForMr } from './api/get_pipelines_for_mr';
import { getPipelinesForRef } from './api/get_pipelines_for_ref';
import { GitLabService } from './gitlab_service';

const byIid = (p1: RestPipeline, p2: RestPipeline) => p2.iid - p1.iid;
const byNewest = (p1: RestPipeline, p2: RestPipeline) => p2.iid - p1.iid || p2.id - p1.id;

// Error handler that distinguishes between real errors and not-found cases
const handleApiError = <T>(error: unknown, context: string): T | undefined => {
  // Log with context for debugging
  if (error instanceof Error) {
    log.error(`${context}: ${error.message}`);
  } else {
    log.error(context, error instanceof Error ? error : new Error(String(error)));
  }
  return undefined;
};

export const getPipelineAndMrForBranch = async (
  gitlabService: GitLabService,
  project: GitLabProject,
  trackingBranchName: string,
  tags: string[] = [],
): Promise<{
  pipeline?: RestPipeline;
  mr?: RestMr;
  isTagPipeline?: boolean;
}> => {
  // Use centralized MR lookup helper (handles normalization, selection, error handling)
  let mr: RestMr | undefined;
  let mrPipeline: RestPipeline | undefined;
  try {
    mr =
      (await findOpenMrForCurrentBranch(gitlabService, project, trackingBranchName)) || undefined;
  } catch (e) {
    handleApiError(e, 'findOpenMrForCurrentBranch failed');
  }

  // Only fetch MR-specific pipeline if MR exists
  if (mr) {
    try {
      const pipelines = await gitlabService.fetchFromApi(getPipelinesForMr(mr));
      if (pipelines && pipelines.length > 0) {
        [mrPipeline] = sort(pipelines, byIid);
      }
    } catch (e) {
      handleApiError(e, `Failed to fetch pipelines for MR !${mr.iid}`);
    }
  }

  // Fetch pipeline by ref (works for both MR and non-MR branches)
  let branchPipeline: RestPipeline | undefined;
  try {
    const pipelines = await gitlabService.fetchFromApi(
      getPipelinesForRef(project, trackingBranchName),
    );
    if (pipelines && pipelines.length > 0) {
      [branchPipeline] = sort(pipelines, byIid);
    }
  } catch (e) {
    handleApiError(e, `Failed to fetch pipelines for ref "${trackingBranchName}"`);
  }

  // Check tag pipelines if any tags are present and there is no MR pipeline (tag pipelines lose to MR pipeline)
  let tagPipeline: RestPipeline | undefined;
  if (!mrPipeline && tags.length > 0) {
    const tagPipelineLists = await Promise.all(
      tags.map(async tag => {
        try {
          return await gitlabService.fetchFromApi(getPipelinesForRef(project, tag));
        } catch (e) {
          handleApiError(e, `Failed to fetch pipelines for tag "${tag}"`);
          return [];
        }
      }),
    );
    const tagPipelines = tagPipelineLists.flat();
    if (tagPipelines.length > 0) {
      [tagPipeline] = sort(tagPipelines, byNewest);
    }
  }

  const candidatePipelines = [mrPipeline, branchPipeline, tagPipeline].filter(
    (p): p is RestPipeline => Boolean(p),
  );
  const [pipeline] = sort(candidatePipelines, byNewest);
  const isTagPipeline = Boolean(pipeline && tagPipeline && pipeline.id === tagPipeline.id);

  return { mr, pipeline, isTagPipeline };
};
