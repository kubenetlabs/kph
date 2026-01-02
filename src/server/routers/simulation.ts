import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

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
});
