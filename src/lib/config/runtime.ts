/**
 * Runtime Environment Configuration
 *
 * Detects whether the application is running on Vercel, in a Docker container,
 * or in local development mode. Used to conditionally enable features like
 * the in-process scheduler.
 */

export const runtime = {
  /** Running on Vercel's platform */
  isVercel: !!process.env.VERCEL,

  /** Running in self-hosted mode (Docker, bare metal, etc.) */
  isSelfHosted: !process.env.VERCEL,

  /** Running in a Docker container */
  isDocker: !!process.env.KPH_DOCKER,

  /** Application URL for internal API calls */
  appUrl:
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),

  /** Whether the in-process scheduler should be enabled */
  shouldRunScheduler: !process.env.VERCEL && process.env.KPH_DISABLE_SCHEDULER !== 'true',
};

export type Runtime = typeof runtime;
