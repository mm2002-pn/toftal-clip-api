/**
 * Triggers the `hls-worker` Cloud Run Job to encode a Version into
 * a 4-rung HLS ladder. Called fire-and-forget from the deliverables
 * controller in parallel with the faststart trigger — the user gets
 * faststart playback in <30s while HLS encodes in the background
 * (5–60 min depending on duration).
 *
 * Same auth + dev-mode no-op as `faststartTrigger`. Failure to enqueue
 * is logged but never thrown — the user's upload response stays clean,
 * and the worst case is that the version stays on Phase 1 faststart
 * playback (no ABR, but still functional).
 */

import { JobsClient } from '@google-cloud/run';
import { config } from '../config';
import { logger } from '../utils/logger';

let _client: JobsClient | null = null;
function getClient(): JobsClient {
  if (!_client) _client = new JobsClient();
  return _client;
}

export async function triggerHlsJob(versionId: string): Promise<void> {
  if (!config.gcp.projectId) {
    logger.info(`[hls-trigger] skipped ${versionId} (no GCP_PROJECT_ID — dev mode)`);
    return;
  }

  const jobPath = `projects/${config.gcp.projectId}/locations/${config.gcp.region}/jobs/${config.gcp.hlsJobName}`;

  try {
    await getClient().runJob({
      name: jobPath,
      overrides: {
        containerOverrides: [
          {
            env: [{ name: 'VERSION_ID', value: versionId }],
          },
        ],
      },
    });
    logger.info(`[hls-trigger] enqueued ${versionId}`);
  } catch (err) {
    logger.error(`[hls-trigger] failed for ${versionId}: ${(err as Error).message}`);
  }
}
