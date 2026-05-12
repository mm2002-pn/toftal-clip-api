/**
 * Triggers the `preview-worker` Cloud Run Job — the third leg of the
 * post-upload pipeline alongside faststart and HLS. Fire-and-forget.
 *
 * Same auth + dev-mode no-op pattern as the other triggers. A failed
 * enqueue is logged but never thrown — the user-visible upload flow
 * stays untouched, and worst case we fall back to faststart / source
 * playback (still functional, just slower on big files).
 */

import { JobsClient } from '@google-cloud/run';
import { config } from '../config';
import { logger } from '../utils/logger';

let _client: JobsClient | null = null;
function getClient(): JobsClient {
  if (!_client) _client = new JobsClient();
  return _client;
}

export async function triggerPreviewJob(versionId: string): Promise<void> {
  if (!config.gcp.projectId) {
    logger.info(`[preview-trigger] skipped ${versionId} (no GCP_PROJECT_ID — dev mode)`);
    return;
  }

  const jobPath = `projects/${config.gcp.projectId}/locations/${config.gcp.region}/jobs/${config.gcp.previewJobName}`;

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
    logger.info(`[preview-trigger] enqueued ${versionId}`);
  } catch (err) {
    logger.error(`[preview-trigger] failed for ${versionId}: ${(err as Error).message}`);
  }
}
