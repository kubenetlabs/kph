/**
 * Next.js Instrumentation Hook
 *
 * This file is loaded once when the Next.js server starts. It's used to
 * initialize the in-process scheduler for self-hosted deployments.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run scheduler in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate configuration early to fail fast
    console.log('[startup] Validating configuration...');
    const { validateConfig } = await import('./lib/config-validator');
    await validateConfig();

    // Start background scheduler
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
