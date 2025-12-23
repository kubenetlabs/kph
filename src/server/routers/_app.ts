import { createTRPCRouter } from "../trpc";
import { policyRouter } from "./policy";
import { clusterRouter } from "./cluster";
import { simulationRouter } from "./simulation";

/**
 * Root router for the application
 * All procedure routes are merged here
 */
export const appRouter = createTRPCRouter({
  policy: policyRouter,
  cluster: clusterRouter,
  simulation: simulationRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;
