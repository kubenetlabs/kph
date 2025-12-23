import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.simulation.update({
    where: { id: "cmji63zje009914q2s0jddvo5" },
    data: { status: "PENDING" },
  });

  console.log("Reset simulation to PENDING:", {
    id: updated.id,
    status: updated.status,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
