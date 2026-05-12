/**
 * Triggers the `faststart-worker` Cloud Run Job to remux a freshly-
 * created Version into a fast-start MP4. Called fire-and-forget from
 * the deliverables controller after a Version row is inserted.
 *
 * The trigger MUST NOT throw on failure — a missing Job, IAM hiccup, or
 * project misconfiguration shouldn't break the user-facing version-
 * upload flow. We log loudly and move on; the original videoUrl still
 * works (just without the faststart benefit).
 *
 * In dev (no GCP_PROJECT_ID set) the trigger no-ops with a log line so
 * `npm run dev` doesn't blow up trying to invoke a non-existent Job.
 */

import { JobsClient } from '@google-cloud/run';
import { config } from '../config';
import { logger } from '../utils/logger';

let _client: JobsClient | null = null;
function getClient(): JobsClient {
  if (!_client) _client = new JobsClient();
  return _client;
}

/**
 * Schedule a faststart remux for the given Version. Returns immediately;
 * the Job runs asynchronously and emits `version:playback-ready` when
 * done. Safe to call from inside a request handler.
 */
export async function triggerFaststartJob(versionId: string): Promise<void> {
  if (!config.gcp.projectId) {
    logger.info(`[faststart-trigger] skipped ${versionId} (no GCP_PROJECT_ID — dev mode)`);
    return;
  }

  const jobPath = `projects/${config.gcp.projectId}/locations/${config.gcp.region}/jobs/${config.gcp.faststartJobName}`;

  try {
    // We don't await the Job's completion — we await the API call that
    // *enqueues* the execution (the SDK returns the long-running op).
    // .runJob() returns [Operation], not the result.
    await getClient().runJob({
      name: jobPath,
      overrides: {
        containerOverrides: [
          {
            // The Job's container doesn't know which Version to process
            // until we tell it via env. Single-task per execution.
            env: [{ name: 'VERSION_ID', value: versionId }],
          },
        ],
      },
    });
    logger.info(`[faststart-trigger] enqueued ${versionId}`);
  } catch (err) {
    // Don't rethrow — see file header. A failed enqueue should not
    // break the response to the user who just uploaded a video.
    logger.error(
      `[faststart-trigger] failed for ${versionId}: ${(err as Error).message}`
    );
  }
}
