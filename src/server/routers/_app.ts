import { createTRPCRouter } from "../trpc";
import { policyRouter } from "./policy";
import { clusterRouter } from "./cluster";

/**
 * Root router for the application
 * All procedure routes are merged here
 */
export const appRouter = createTRPCRouter({
  policy: policyRouter,
  cluster: clusterRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;
