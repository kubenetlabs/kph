import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const simulations = await prisma.simulation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      cluster: { select: { id: true, name: true } },
      policy: { select: { id: true, name: true } },
    },
  });

  console.log("Pending simulations:");
  simulations.forEach((s) =>
    console.log({
      id: s.id,
      name: s.name,
      status: s.status,
      clusterId: s.clusterId,
      clusterName: s.cluster?.name,
      policyId: s.policyId,
      policyName: s.policy?.name,
    })
  );

  console.log("\n\nExpected cluster ID: cmj93fby70002oaszlq3c2oxl");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
