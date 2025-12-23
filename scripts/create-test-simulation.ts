import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find the cluster
  const cluster = await prisma.cluster.findFirst();
  if (!cluster) {
    console.error("No cluster found");
    return;
  }
  console.log("Using cluster:", cluster.id, cluster.name);

  // Find an org
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.error("No organization found");
    return;
  }
  console.log("Using organization:", org.id, org.name);

  // Find a user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("No user found");
    return;
  }
  console.log("Using user:", user.id, user.email);

  // Find or create a policy
  let policy = await prisma.policy.findFirst({
    where: { name: "test-deny-tiefighter-egress" },
  });

  if (!policy) {
    policy = await prisma.policy.create({
      data: {
        name: "test-deny-tiefighter-egress",
        description: "Deny tiefighter egress to deathstar",
        type: "CILIUM_NETWORK",
        content: `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-deny-all-egress
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      class: tiefighter
  egressDeny:
    - toEndpoints:
        - matchLabels:
            org: empire
            class: deathstar
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP`,
        status: "DRAFT",
        organization: { connect: { id: org.id } },
        cluster: { connect: { id: cluster.id } },
        targetNamespaces: ["default"],
        createdBy: { connect: { id: user.id } },
      },
    });
    console.log("Created policy:", policy.id, policy.name);
  } else {
    console.log("Using existing policy:", policy.id, policy.name);
  }

  // Create a new simulation with time range covering the last hour
  const now = new Date();
  const startTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

  const simulation = await prisma.simulation.create({
    data: {
      name: "Test deny tiefighter->deathstar simulation",
      description: "Testing simulation with fresh traffic data",
      cluster: { connect: { id: cluster.id } },
      organization: { connect: { id: org.id } },
      policy: { connect: { id: policy.id } },
      runner: { connect: { id: user.id } },
      status: "PENDING",
      startTime: startTime,
      endTime: now,
    },
  });

  console.log("Created simulation:", {
    id: simulation.id,
    name: simulation.name,
    status: simulation.status,
    startTime: simulation.startTime,
    endTime: simulation.endTime,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
