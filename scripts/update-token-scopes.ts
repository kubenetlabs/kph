import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clusterId = "cmj93fby70002oaszlq3c2oxl";

  // Find the token for this cluster
  const token = await prisma.apiToken.findFirst({
    where: {
      clusterId: clusterId,
    },
  });

  if (!token) {
    console.error("Token not found for cluster:", clusterId);
    process.exit(1);
  }

  console.log("Current token:", {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
  });

  // Add simulation scopes if not present
  const newScopes = new Set(token.scopes);
  newScopes.add("simulation:read");
  newScopes.add("simulation:write");

  const updatedScopes = Array.from(newScopes);

  // Update the token
  const updated = await prisma.apiToken.update({
    where: { id: token.id },
    data: {
      scopes: updatedScopes,
    },
  });

  console.log("Updated token:", {
    id: updated.id,
    name: updated.name,
    scopes: updated.scopes,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
