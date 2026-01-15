import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import {
  simulateTracingPolicy,
  type ProcessSummaryInput,
} from "~/lib/tetragon-policy-evaluator";

// Use orgProtectedProcedure for all simulation operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

const SimulationStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const listSimulationsSchema = z.object({
  clusterId: z.string().optional(),
  policyId: z.string().optional(),
  status: SimulationStatusSchema.optional(),
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const createSimulationSchema = z.object({
  policyId: z.string(),
  clusterId: z.string(),
  daysToAnalyze: z.number().min(1).max(30).default(7),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const simulationRouter = createTRPCRouter({
  // List simulations
  list: protectedProcedure
    .input(listSimulationsSchema.optional())
    .query(async ({ ctx, input }) => {
      const { clusterId, policyId, status, limit = 50, cursor } = input ?? {};

      const where = {
        organizationId: ctx.organizationId,
        ...(clusterId && { clusterId }),
        ...(policyId && { policyId }),
        ...(status && { status }),
      };

      const simulations = await ctx.db.simulation.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: "desc" },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
            },
          },
          runner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      let nextCursor: string | undefined = undefined;
      if (simulations.length > limit) {
        const nextItem = simulations.pop();
        nextCursor = nextItem?.id;
      }

      return {
        simulations,
        nextCursor,
      };
    }),

  // Get single simulation by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const simulation = await ctx.db.simulation.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
              type: true,
              content: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
              region: true,
            },
          },
          runner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!simulation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Simulation not found",
        });
      }

      return simulation;
    }),

  // Create a new simulation
  create: protectedProcedure
    .input(createSimulationSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Calculate time range
      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - input.daysToAnalyze);

      const simulation = await ctx.db.simulation.create({
        data: {
          name: input.name ?? `${policy.name} simulation`,
          description: input.description ?? `Simulation for ${policy.name} on ${cluster.name}`,
          status: "PENDING",
          startTime,
          endTime,
          organizationId: ctx.organizationId,
          clusterId: input.clusterId,
          policyId: input.policyId,
          runnerId: ctx.userId,
        },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return simulation;
    }),

  // Cancel a simulation
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.simulation.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Simulation not found",
        });
      }

      if (existing.status !== "PENDING" && existing.status !== "RUNNING") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot cancel a simulation that is not pending or running",
        });
      }

      const simulation = await ctx.db.simulation.update({
        where: { id: input.id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });

      return simulation;
    }),

  // Delete a simulation
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.simulation.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Simulation not found",
        });
      }

      await ctx.db.simulation.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  // Get simulation stats for dashboard
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [total, running, completed, failed] = await Promise.all([
      ctx.db.simulation.count({
        where: { organizationId: ctx.organizationId },
      }),
      ctx.db.simulation.count({
        where: { organizationId: ctx.organizationId, status: "RUNNING" },
      }),
      ctx.db.simulation.count({
        where: { organizationId: ctx.organizationId, status: "COMPLETED" },
      }),
      ctx.db.simulation.count({
        where: { organizationId: ctx.organizationId, status: "FAILED" },
      }),
    ]);

    // Get total flows analyzed
    const flowsAggregate = await ctx.db.simulation.aggregate({
      where: { organizationId: ctx.organizationId },
      _sum: {
        flowsAnalyzed: true,
        flowsAllowed: true,
        flowsDenied: true,
        flowsChanged: true,
      },
    });

    return {
      total,
      running,
      completed,
      failed,
      flowsAnalyzed: flowsAggregate._sum.flowsAnalyzed ?? 0,
      flowsAllowed: flowsAggregate._sum.flowsAllowed ?? 0,
      flowsDenied: flowsAggregate._sum.flowsDenied ?? 0,
      flowsChanged: flowsAggregate._sum.flowsChanged ?? 0,
    };
  }),

  // Export simulation results as JSON
  exportResults: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        format: z.enum(["json", "csv"]).default("json"),
      })
    )
    .query(async ({ ctx, input }) => {
      const simulation = await ctx.db.simulation.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
              type: true,
              content: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
              region: true,
            },
          },
          runner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!simulation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Simulation not found",
        });
      }

      // Type-safe results parsing
      interface SimulatedFlow {
        srcNamespace: string;
        srcPodName?: string;
        dstNamespace: string;
        dstPodName?: string;
        dstPort: number;
        protocol: string;
        originalVerdict: string;
        simulatedVerdict: string;
        verdictChanged: boolean;
        matchedRule?: string;
        matchReason?: string;
      }

      interface SimulationResults {
        noChangeCount?: number;
        breakdownByNamespace?: Record<string, unknown>;
        breakdownByVerdict?: Record<string, number>;
        sampleFlows?: SimulatedFlow[];
        errors?: string[];
        durationNs?: number;
      }

      const results = simulation.results as SimulationResults | null;

      if (input.format === "csv") {
        // Generate CSV for sample flows
        const sampleFlows = results?.sampleFlows ?? [];
        const headers = [
          "srcNamespace",
          "srcPodName",
          "dstNamespace",
          "dstPodName",
          "dstPort",
          "protocol",
          "originalVerdict",
          "simulatedVerdict",
          "verdictChanged",
          "matchedRule",
          "matchReason",
        ];

        const rows = sampleFlows.map((flow) => [
          flow.srcNamespace,
          flow.srcPodName ?? "",
          flow.dstNamespace,
          flow.dstPodName ?? "",
          flow.dstPort.toString(),
          flow.protocol,
          flow.originalVerdict,
          flow.simulatedVerdict,
          flow.verdictChanged.toString(),
          flow.matchedRule ?? "",
          flow.matchReason ?? "",
        ]);

        const csvContent = [
          headers.join(","),
          ...rows.map((row) =>
            row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
          ),
        ].join("\n");

        return {
          format: "csv" as const,
          filename: `simulation-${simulation.id}-flows.csv`,
          content: csvContent,
          mimeType: "text/csv",
        };
      }

      // JSON export
      const exportData = {
        simulation: {
          id: simulation.id,
          name: simulation.name,
          description: simulation.description,
          status: simulation.status,
          startTime: simulation.startTime.toISOString(),
          endTime: simulation.endTime.toISOString(),
          createdAt: simulation.createdAt.toISOString(),
          completedAt: simulation.completedAt?.toISOString(),
        },
        policy: simulation.policy,
        cluster: simulation.cluster,
        runner: simulation.runner,
        metrics: {
          flowsAnalyzed: simulation.flowsAnalyzed,
          flowsAllowed: simulation.flowsAllowed,
          flowsDenied: simulation.flowsDenied,
          flowsChanged: simulation.flowsChanged,
        },
        results: results ?? null,
      };

      return {
        format: "json" as const,
        filename: `simulation-${simulation.id}.json`,
        content: JSON.stringify(exportData, null, 2),
        mimeType: "application/json",
      };
    }),

  // Simulate a Tetragon TracingPolicy against ProcessSummary data (SaaS-side)
  simulateTetragonPolicy: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        clusterId: z.string(),
        daysToAnalyze: z.number().min(1).max(30).default(7),
        name: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log("[Tetragon Simulation] simulateTetragonPolicy mutation called with:", {
        policyId: input.policyId,
        clusterId: input.clusterId,
        daysToAnalyze: input.daysToAnalyze,
      });

      // Verify policy belongs to organization and is a Tetragon policy
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (policy.type !== "TETRAGON") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Policy must be a TETRAGON TracingPolicy for process simulation",
        });
      }

      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Calculate time range
      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - input.daysToAnalyze);

      // Create simulation record (mark as RUNNING since we'll complete it synchronously)
      const simulation = await ctx.db.simulation.create({
        data: {
          name: input.name ?? `${policy.name} process simulation`,
          description: input.description ?? `Tetragon simulation for ${policy.name} on ${cluster.name}`,
          status: "RUNNING",
          startTime,
          endTime,
          organizationId: ctx.organizationId,
          clusterId: input.clusterId,
          policyId: input.policyId,
          runnerId: ctx.userId,
        },
      });

      try {
        // Fetch ProcessSummary data for the cluster within the time range
        const processSummaries = await ctx.db.processSummary.findMany({
          where: {
            clusterId: input.clusterId,
            // Get summaries within the time window
            windowEnd: {
              gte: startTime,
              lte: endTime,
            },
          },
        });

        console.log("[Tetragon Simulation] Fetched ProcessSummary records:", processSummaries.length);
        console.log("[Tetragon Simulation] Time range:", startTime.toISOString(), "to", endTime.toISOString());
        console.log("[Tetragon Simulation] Policy namespace:", policy.content.includes("TracingPolicyNamespaced") ? "namespaced" : "cluster-wide");

        // Log namespace breakdown
        const namespaceBreakdown: Record<string, number> = {};
        processSummaries.forEach(ps => {
          namespaceBreakdown[ps.namespace] = (namespaceBreakdown[ps.namespace] ?? 0) + 1;
        });
        console.log("[Tetragon Simulation] Namespace breakdown:", namespaceBreakdown);

        // Log sample of shell-related processes for debugging
        const shellProcesses = processSummaries.filter(ps =>
          ps.processName.endsWith('/sh') ||
          ps.processName.endsWith('/bash') ||
          ps.processName.endsWith('/zsh')
        );
        console.log("[Tetragon Simulation] Shell processes found:", shellProcesses.length);
        if (shellProcesses.length > 0) {
          console.log("[Tetragon Simulation] Sample shell processes:", shellProcesses.slice(0, 5).map(p => ({
            namespace: p.namespace,
            processName: p.processName,
            execCount: p.execCount
          })));
        }

        // Log the policy content preview
        console.log("[Tetragon Simulation] Policy content preview:", policy.content.substring(0, 500));

        // Transform ProcessSummary records to the format expected by the evaluator
        const processInputs: ProcessSummaryInput[] = processSummaries.map((ps) => ({
          id: ps.id,
          namespace: ps.namespace,
          podName: ps.podName,
          processName: ps.processName,
          execCount: ps.execCount,
          syscallCounts: ps.syscallCounts as Record<string, number> | null,
        }));

        // Run the simulation
        const simulationResult = simulateTracingPolicy(policy.content, processInputs);

        console.log("[Tetragon Simulation] Result:", {
          totalProcesses: simulationResult.totalProcesses,
          wouldBlockCount: simulationResult.wouldBlockCount,
          wouldAllowCount: simulationResult.wouldAllowCount
        });

        // Update simulation with results (serialize to JSON-safe format)
        const completedSimulation = await ctx.db.simulation.update({
          where: { id: simulation.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            flowsAnalyzed: simulationResult.totalProcesses,
            flowsAllowed: simulationResult.wouldAllowCount,
            flowsDenied: simulationResult.wouldBlockCount,
            flowsChanged: simulationResult.wouldBlockCount, // For Tetragon, blocked = would be new enforcement
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            results: JSON.parse(JSON.stringify({
              type: "TETRAGON",
              policyName: simulationResult.policyName,
              policyNamespace: simulationResult.policyNamespace,
              totalProcesses: simulationResult.totalProcesses,
              totalExecs: simulationResult.totalExecs,
              wouldBlockCount: simulationResult.wouldBlockCount,
              wouldBlockExecs: simulationResult.wouldBlockExecs,
              wouldAllowCount: simulationResult.wouldAllowCount,
              wouldAllowExecs: simulationResult.wouldAllowExecs,
              breakdownByNamespace: simulationResult.breakdownByNamespace,
              sampleBlockedProcesses: simulationResult.sampleBlockedProcesses,
              sampleAllowedProcesses: simulationResult.sampleAllowedProcesses,
            })),
          },
          include: {
            policy: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
            cluster: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        });

        return {
          simulation: completedSimulation,
          results: simulationResult,
        };
      } catch (error) {
        // Mark simulation as failed
        await ctx.db.simulation.update({
          where: { id: simulation.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            results: {
              type: "TETRAGON",
              error: error instanceof Error ? error.message : "Unknown error",
            },
          },
        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Simulation failed",
        });
      }
    }),
});
