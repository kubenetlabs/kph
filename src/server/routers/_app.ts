import { createTRPCRouter } from "../trpc";
import { policyRouter } from "./policy";
import { clusterRouter } from "./cluster";
import { simulationRouter } from "./simulation";
import { deploymentRouter } from "./deployment";
import { validationRouter } from "./validation";
import { marketplaceRouter } from "./marketplace";
import { onboardingRouter } from "./onboarding";
import { topologyRouter } from "./topology";

/**
 * Root router for the application
 * All procedure routes are merged here
 */
export const appRouter = createTRPCRouter({
  policy: policyRouter,
  cluster: clusterRouter,
  simulation: simulationRouter,
  deployment: deploymentRouter,
  validation: validationRouter,
  marketplace: marketplaceRouter,
  onboarding: onboardingRouter,
  topology: topologyRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;
