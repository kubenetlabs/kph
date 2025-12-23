import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clusterId = "cmj93fby70002oaszlq3c2oxl";

  const simulations = await prisma.simulation.findMany({
    where: { clusterId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log("Recent simulations:");
  simulations.forEach((s) =>
    console.log({
      id: s.id,
      name: s.name,
      status: s.status,
      flowsAnalyzed: s.flowsAnalyzed,
      flowsChanged: s.flowsChanged,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
    })
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
