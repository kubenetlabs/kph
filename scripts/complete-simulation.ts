import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Complete one simulation to show the flow works
  const simulationId = "cmji66au900014de700tre3pm";

  // Update simulation with mock results
  const updated = await prisma.simulation.update({
    where: { id: simulationId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      flowsAnalyzed: 1250,
      flowsAllowed: 1100,
      flowsDenied: 50,
      flowsChanged: 100,
      results: {
        noChangeCount: 1150,
        breakdownByNamespace: {
          default: {
            namespace: "default",
            totalFlows: 1250,
            allowedCount: 1100,
            deniedCount: 50,
            wouldDeny: 75,
            wouldAllow: 25,
            noChange: 1150,
          },
        },
        breakdownByVerdict: {
          allowedToAllowed: 1025,
          allowedToDenied: 75,
          deniedToAllowed: 25,
          deniedToDenied: 25,
          droppedToAllowed: 0,
          droppedToDenied: 0,
        },
        sampleFlows: [
          {
            srcNamespace: "default",
            srcPodName: "tiefighter-1",
            dstNamespace: "default",
            dstPodName: "deathstar-1",
            dstPort: 80,
            protocol: "TCP",
            originalVerdict: "ALLOWED",
            simulatedVerdict: "ALLOWED",
            verdictChanged: false,
            matchedRule: "allow-access-to-deathstar",
            matchReason: "Matched label: org=empire",
          },
          {
            srcNamespace: "default",
            srcPodName: "xwing-1",
            dstNamespace: "default",
            dstPodName: "deathstar-1",
            dstPort: 80,
            protocol: "TCP",
            originalVerdict: "ALLOWED",
            simulatedVerdict: "DENIED",
            verdictChanged: true,
            matchedRule: "allow-access-to-deathstar",
            matchReason: "No matching label: org=empire not found on source",
          },
        ],
        durationNs: 125000000, // 125ms
      },
    },
  });

  console.log("Simulation completed:", {
    id: updated.id,
    name: updated.name,
    status: updated.status,
    flowsAnalyzed: updated.flowsAnalyzed,
    flowsChanged: updated.flowsChanged,
    completedAt: updated.completedAt,
  });

  // Reset the other simulation to PENDING for Vercel testing
  const reset = await prisma.simulation.update({
    where: { id: "cmji63zje009914q2s0jddvo5" },
    data: { status: "PENDING" },
  });

  console.log("\nReset simulation to PENDING:", {
    id: reset.id,
    status: reset.status,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
