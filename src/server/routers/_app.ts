import { createTRPCRouter } from "../trpc";
import { policyRouter } from "./policy";
import { clusterRouter } from "./cluster";
import { simulationRouter } from "./simulation";
import { deploymentRouter } from "./deployment";
import { validationRouter } from "./validation";
import { processValidationRouter } from "./process-validation";
import { marketplaceRouter } from "./marketplace";
import { onboardingRouter } from "./onboarding";
import { topologyRouter } from "./topology";
import { templateRouter } from "./template";
import { recommendationsRouter } from "./recommendations";

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
  processValidation: processValidationRouter,
  marketplace: marketplaceRouter,
  onboarding: onboardingRouter,
  topology: topologyRouter,
  template: templateRouter,
  recommendations: recommendationsRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;
