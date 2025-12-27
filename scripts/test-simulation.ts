import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cluster = await prisma.cluster.findFirst({ where: { id: "cmj93fby70002oaszlq3c2oxl" }});
  const org = await prisma.organization.findFirst();
  const user = await prisma.user.findFirst();
  const policy = await prisma.policy.findFirst({ where: { name: "deathstar-access-policy" }});

  if (!cluster || !org || !user || !policy) {
    console.error("Missing required data");
    return;
  }

  const now = new Date();
  const startTime = new Date(now.getTime() - 3 * 60 * 1000); // 3 minutes ago

  const simulation = await prisma.simulation.create({
    data: {
      name: "Test ingress fix simulation",
      description: "Testing fixed simulation engine for ingress rules",
      cluster: { connect: { id: cluster.id } },
      organization: { connect: { id: org.id } },
      policy: { connect: { id: policy.id } },
      runner: { connect: { id: user.id } },
      status: "PENDING",
      startTime: startTime,
      endTime: now,
    },
  });

  console.log("Created simulation:", simulation.id);
  console.log("Time range:", startTime.toISOString(), "to", now.toISOString());

  // Wait for it to be processed
  console.log("Waiting 45s for simulation to be processed...");
  await new Promise(resolve => setTimeout(resolve, 45000));

  // Check results
  const result = await prisma.simulation.findUnique({
    where: { id: simulation.id },
  });

  if (!result) {
    console.log("Simulation not found");
    return;
  }

  console.log("\n=== Results ===");
  console.log("Status:", result.status);
  console.log("Flows analyzed:", result.flowsAnalyzed);
  console.log("Flows changed:", result.flowsChanged);

  if (result.results) {
    const r = result.results as any;
    console.log("\nBreakdown:");
    console.log("  Allowed:", r.allowedCount);
    console.log("  Denied:", r.deniedCount);
    console.log("  No change:", r.noChangeCount);

    if (r.breakdownByVerdict) {
      console.log("\nVerdict changes:");
      console.log("  Allowed->Allowed:", r.breakdownByVerdict.allowedToAllowed);
      console.log("  Allowed->Denied:", r.breakdownByVerdict.allowedToDenied);
      console.log("  Denied->Allowed:", r.breakdownByVerdict.deniedToAllowed);
    }

    if (r.sampleFlows && r.sampleFlows.length > 0) {
      console.log("\nSample flows:");
      r.sampleFlows.slice(0, 15).forEach((f: any) => {
        const src = f.srcPodName || f.srcNamespace || "unknown";
        const dst = f.dstPodName || f.dstNamespace || "unknown";
        const changed = f.verdictChanged ? " ** CHANGED **" : "";
        console.log(`  ${src} -> ${dst}:${f.dstPort} | ${f.originalVerdict} -> ${f.simulatedVerdict}${changed} | ${f.matchReason}`);
      });
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
