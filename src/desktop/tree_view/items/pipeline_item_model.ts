import * as vscode from 'vscode';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getJobMetadata, getPipelineMetadata } from '../../gitlab/ci_status_metadata';
import { compare } from '../../../common/utils/compare';
import { hasDownloadableArtifacts } from '../../utils/has_downloadable_artifacts';
import { ProjectInRepository, ProjectInRepositoryProvider } from '../../gitlab/new_project';
import { openInBrowserCommand } from '../../utils/open_in_browser_command';
import { ItemModel } from './item_model';
import { StageItemModel } from './stage_item_model';
import { JobProvider } from './job_provider';
import { PipelineProvider } from './pipeline_provider';

dayjs.extend(relativeTime);
/** removes duplicates based on === equality. Can be replaced with lodash. */
const uniq = <T>(duplicated: T[]): T[] => [...new Set(duplicated)];

const getUniqueStages = (jobs: RestJob[]): string[] => uniq(jobs.map(j => j.stage));

/**
 * Orders jobs the way the pipeline created them. A retried job has a new, higher ID,
 * so it is placed by the ID of its first attempt instead of moving to the end.
 */
const compareByCreationOrder = (a: RestJob, b: RestJob) =>
  compare(a.firstAttemptId ?? a.id, b.firstAttemptId ?? b.id);

const getPipelineItemContextValue = (jobs: RestJob[]) => {
  const contextValue: string[] = ['with-url'];
  if (jobs.find(job => getJobMetadata(job).contextAction === 'cancellable')) {
    contextValue.push('cancellable-pipeline');
  }
  if (jobs.find(job => getJobMetadata(job).contextAction === 'retryable')) {
    contextValue.push('retryable-pipeline');
  }
  if (hasDownloadableArtifacts(jobs)) {
    contextValue.push('with-artifacts');
  }
  return contextValue.join(',');
};

export class PipelineItemModel
  extends ItemModel
  implements JobProvider, PipelineProvider, ProjectInRepositoryProvider
{
  projectInRepository: ProjectInRepository;

  pipeline: RestPipeline;

  jobs: RestJob[];

  name: string;

  isBusy: boolean;

  busyJobs: ReadonlySet<number>;

  constructor(
    projectInRepository: ProjectInRepository,
    pipeline: RestPipeline,
    jobs: RestJob[],
    name: string = 'Pipeline',
    isBusy: boolean = false,
    busyJobs?: ReadonlySet<number>,
  ) {
    super();
    this.projectInRepository = projectInRepository;
    this.pipeline = pipeline;
    this.jobs = jobs;
    this.name = name;
    this.isBusy = isBusy;
    this.busyJobs = busyJobs ?? new Set();
  }

  getTreeItem(): vscode.TreeItem {
    const timeAgo = dayjs(this.pipeline.updated_at).fromNow();
    const label = `${this.name} #${this.pipeline.id}`;
    const item = new vscode.TreeItem(
      label,
      this.jobs.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    const statusMetadata = getPipelineMetadata(this.pipeline, this.isBusy);
    item.tooltip = `${label} · ${statusMetadata.name} · ${timeAgo}`;

    if (this.pipeline.source === 'pipeline') {
      item.tooltip += '\nMulti-project';
    } else if (this.pipeline.source === 'parent_pipeline') {
      item.tooltip += '\nChild pipeline';
    }

    if (!this.jobs.length) {
      item.command = openInBrowserCommand(this.pipeline.web_url);
    }

    item.description = statusMetadata.name;
    item.iconPath = statusMetadata.icon;
    item.contextValue = getPipelineItemContextValue(this.jobs);
    return item;
  }

  async getChildren(): Promise<ItemModel[]> {
    const jobsAsc = this.jobs.sort(compareByCreationOrder);
    const stages = getUniqueStages(jobsAsc);
    const stagesWithJobs = stages.map(stageName => ({
      name: stageName,
      jobs: jobsAsc.filter(j => j.stage === stageName),
    }));

    const children: ItemModel[] = stagesWithJobs.map(
      sj => new StageItemModel(this.projectInRepository, sj.name, sj.jobs, this.busyJobs),
    );
    return children;
  }
}
