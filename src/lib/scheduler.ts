/**
 * In-Process Scheduler for Self-Hosted Deployments
 *
 * Replaces Vercel Cron for self-hosted environments. Uses node-cron to run
 * scheduled tasks that would otherwise be triggered by Vercel's cron infrastructure.
 *
 * This module is only loaded in self-hosted mode (not on Vercel).
 */

import cron from 'node-cron';
import { runtime } from './config/runtime';

let schedulerStarted = false;

/**
 * Start the in-process scheduler for self-hosted deployments.
 * This is a no-op on Vercel (Vercel Cron handles scheduling there).
 */
export function startScheduler(): void {
  // Prevent double-initialization
  if (schedulerStarted) {
    return;
  }

  // Don't run on Vercel or if explicitly disabled
  if (!runtime.shouldRunScheduler) {
    console.log('[scheduler] Skipping scheduler start (Vercel detected or scheduler disabled)');
    return;
  }

  schedulerStarted = true;
  const baseUrl = runtime.appUrl;
  const cronSecret = process.env.CRON_SECRET;

  console.log('[scheduler] Starting KPH scheduler (self-hosted mode)');
  console.log(`[scheduler] Base URL: ${baseUrl}`);

  // Cluster health check - every 10 minutes (matches vercel.json)
  cron.schedule('*/10 * * * *', async () => {
    console.log('[scheduler] Running cluster health check...');
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Include CRON_SECRET if configured
      if (cronSecret) {
        headers.Authorization = `Bearer ${cronSecret}`;
      }

      const response = await fetch(`${baseUrl}/api/cron/cluster-health`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        console.error(`[scheduler] Cluster health check failed: ${response.status}`);
        return;
      }

      const result = (await response.json()) as Record<string, unknown>;
      console.log('[scheduler] Cluster health check completed:', result);
    } catch (error) {
      console.error('[scheduler] Cluster health check error:', error);
    }
  });

  console.log('[scheduler] Scheduled jobs:');
  console.log('[scheduler]   - cluster-health: */10 * * * * (every 10 minutes)');
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return schedulerStarted;
}
