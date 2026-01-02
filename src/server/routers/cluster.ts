import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import { encrypt, generateApiToken } from "~/lib/encryption";
import { testKubernetesConnection } from "~/lib/kubernetes-client";

// Use orgProtectedProcedure for all cluster operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

// Schema for creating a cluster
const createClusterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  provider: z.enum(["AWS", "GCP", "AZURE", "ON_PREM", "OTHER"]),
  region: z.string().min(1),
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT", "TESTING"]),
  endpoint: z.string().url(),
  authToken: z.string().min(1),
  caCert: z.string().optional(),
});

// Schema for updating a cluster
const updateClusterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT", "TESTING"]).optional(),
  endpoint: z.string().url().optional(),
  authToken: z.string().min(1).optional(),
  caCert: z.string().optional(),
});

export const clusterRouter = createTRPCRouter({
  // List clusters for organization (used in policy form dropdown and clusters page)
  list: protectedProcedure.query(async ({ ctx }) => {
    const clusters = await ctx.db.cluster.findMany({
      where: {
        organizationId: ctx.organizationId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        provider: true,
        region: true,
        environment: true,
        status: true,
        operatorInstalled: true,
        operatorVersion: true,
        operatorId: true,
        lastHeartbeat: true,
        kubernetesVersion: true,
        nodeCount: true,
        namespaceCount: true,
        createdAt: true,
        _count: {
          select: {
            policies: true,
          },
        },
      },
    });

    return clusters;
  }),

  // Get single cluster by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          _count: {
            select: {
              policies: true,
            },
          },
        },
      });

      return cluster;
    }),

  // Create a new cluster with credentials
  create: protectedProcedure
    .input(createClusterSchema)
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate name
      const existing = await ctx.db.cluster.findFirst({
        where: {
          organizationId: ctx.organizationId,
          name: input.name,
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A cluster with this name already exists",
        });
      }

      // Encrypt sensitive data
      const encryptedToken = encrypt(input.authToken);
      const encryptedCaCert = input.caCert ? encrypt(input.caCert) : null;

      // Create the cluster
      const cluster = await ctx.db.cluster.create({
        data: {
          name: input.name,
          description: input.description,
          provider: input.provider,
          region: input.region,
          environment: input.environment,
          endpoint: input.endpoint,
          authToken: encryptedToken,
          caCert: encryptedCaCert,
          authMethod: "TOKEN",
          organizationId: ctx.organizationId,
        },
      });

      // Generate an API token for the operator
      const { token, tokenHash, prefix } = generateApiToken();

      await ctx.db.apiToken.create({
        data: {
          name: `Operator token for ${cluster.name}`,
          tokenHash,
          prefix,
          scopes: ["cluster:read", "cluster:write", "policy:read", "policy:write", "flow:write", "telemetry:write", "simulation:read", "simulation:write"],
          clusterId: cluster.id,
          organizationId: ctx.organizationId,
        },
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "cluster.created",
          resource: "Cluster",
          resourceId: cluster.id,
          userId: ctx.userId,
          details: {
            name: cluster.name,
            provider: cluster.provider,
            region: cluster.region,
          },
          organizationId: ctx.organizationId,
        },
      });

      return {
        cluster,
        operatorToken: token, // Only returned once!
      };
    }),

  // Update cluster settings
  update: protectedProcedure
    .input(updateClusterSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const existing = await ctx.db.cluster.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Check for name conflict
      if (input.name && input.name !== existing.name) {
        const nameConflict = await ctx.db.cluster.findFirst({
          where: {
            organizationId: ctx.organizationId,
            name: input.name,
            id: { not: input.id },
          },
        });

        if (nameConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A cluster with this name already exists",
          });
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (input.name) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.environment) updateData.environment = input.environment;
      if (input.endpoint) updateData.endpoint = input.endpoint;
      if (input.authToken) updateData.authToken = encrypt(input.authToken);
      if (input.caCert !== undefined) {
        updateData.caCert = input.caCert ? encrypt(input.caCert) : null;
      }

      const cluster = await ctx.db.cluster.update({
        where: { id: input.id },
        data: updateData,
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "cluster.updated",
          resource: "Cluster",
          resourceId: cluster.id,
          userId: ctx.userId,
          details: { updatedFields: Object.keys(updateData) },
          organizationId: ctx.organizationId,
        },
      });

      return cluster;
    }),

  // Delete a cluster
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Delete the cluster (cascades to policies, api tokens, etc.)
      await ctx.db.cluster.delete({
        where: { id: input.id },
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "cluster.deleted",
          resource: "Cluster",
          resourceId: input.id,
          userId: ctx.userId,
          details: { name: cluster.name },
          organizationId: ctx.organizationId,
        },
      });

      return { success: true };
    }),

  // Test connection to Kubernetes cluster
  testConnection: protectedProcedure
    .input(z.object({
      endpoint: z.string().url(),
      token: z.string().min(1),
      caCert: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await testKubernetesConnection(
        input.endpoint,
        input.token,
        input.caCert
      );

      return result;
    }),

  // Regenerate operator API token
  regenerateToken: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
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

      // Revoke existing tokens for this cluster
      await ctx.db.apiToken.updateMany({
        where: {
          clusterId: input.clusterId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      // Generate new API token
      const { token, tokenHash, prefix } = generateApiToken();

      await ctx.db.apiToken.create({
        data: {
          name: `Operator token for ${cluster.name}`,
          tokenHash,
          prefix,
          scopes: ["cluster:read", "cluster:write", "policy:read", "policy:write", "flow:write", "telemetry:write", "simulation:read", "simulation:write"],
          clusterId: cluster.id,
          organizationId: ctx.organizationId,
        },
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "cluster.token_regenerated",
          resource: "Cluster",
          resourceId: cluster.id,
          userId: ctx.userId,
          organizationId: ctx.organizationId,
        },
      });

      return {
        token, // Only returned once!
        prefix,
      };
    }),

  // Get operator installation instructions
  getInstallInstructions: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ ctx, input }) => {
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

      const saasEndpoint = process.env.NEXTAUTH_URL ?? "https://policy-hub.example.com";

      const helmInstall = `# Add the Policy Hub Helm repository
helm repo add policy-hub https://charts.policy-hub.io
helm repo update

# Create namespace
kubectl create namespace policy-hub-system

# Create secret with API token (replace <API_TOKEN> with your token)
kubectl create secret generic policy-hub-operator \\
  --namespace policy-hub-system \\
  --from-literal=api-token=<API_TOKEN>

# Install the operator
helm install policy-hub-operator policy-hub/operator \\
  --namespace policy-hub-system \\
  --set config.saasEndpoint=${saasEndpoint} \\
  --set config.clusterId=${cluster.id}`;

      const kubectlApply = `# Create namespace
kubectl create namespace policy-hub-system

# Create secret with API token (replace <API_TOKEN> with your token)
kubectl create secret generic policy-hub-operator \\
  --namespace policy-hub-system \\
  --from-literal=api-token=<API_TOKEN>

# Apply the operator manifest
kubectl apply -f https://raw.githubusercontent.com/policy-hub/operator/main/deploy/operator.yaml

# Create the configuration
cat <<EOF | kubectl apply -f -
apiVersion: policyhub.io/v1alpha1
kind: PolicyHubConfig
metadata:
  name: policy-hub-config
  namespace: policy-hub-system
spec:
  saasEndpoint: ${saasEndpoint}
  clusterId: ${cluster.id}
  apiTokenSecretRef:
    name: policy-hub-operator
    key: api-token
  syncInterval: 30s
  heartbeatInterval: 60s
EOF`;

      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        saasEndpoint,
        helmInstall,
        kubectlApply,
      };
    }),

  // ============================================
  // Registration Token Management
  // ============================================

  // Create a registration token (org-level token for operator bootstrap)
  createRegistrationToken: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { token, tokenHash, prefix } = generateApiToken();

      // Calculate expiration date if provided
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const apiToken = await ctx.db.apiToken.create({
        data: {
          name: input.name,
          tokenHash,
          prefix,
          scopes: ["cluster:create"], // Only cluster:create scope - allows bootstrap
          organizationId: ctx.organizationId,
          expiresAt,
          // Note: no clusterId - this is an org-level token
        },
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "registration_token.created",
          resource: "ApiToken",
          resourceId: apiToken.id,
          userId: ctx.userId,
          details: {
            name: input.name,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          organizationId: ctx.organizationId,
        },
      });

      return {
        id: apiToken.id,
        token, // Only returned once!
        prefix,
        name: apiToken.name,
        expiresAt: apiToken.expiresAt,
      };
    }),

  // List registration tokens for organization
  listRegistrationTokens: protectedProcedure.query(async ({ ctx }) => {
    const tokens = await ctx.db.apiToken.findMany({
      where: {
        organizationId: ctx.organizationId,
        clusterId: null, // Only org-level tokens (no cluster)
        scopes: { has: "cluster:create" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });

    return tokens;
  }),

  // Revoke a registration token
  revokeRegistrationToken: protectedProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Find the token and verify ownership
      const token = await ctx.db.apiToken.findFirst({
        where: {
          id: input.tokenId,
          organizationId: ctx.organizationId,
          clusterId: null, // Must be an org-level token
        },
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registration token not found",
        });
      }

      if (token.revokedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Token is already revoked",
        });
      }

      // Revoke the token
      await ctx.db.apiToken.update({
        where: { id: input.tokenId },
        data: { revokedAt: new Date() },
      });

      // Create audit log
      await ctx.db.auditLog.create({
        data: {
          action: "registration_token.revoked",
          resource: "ApiToken",
          resourceId: input.tokenId,
          userId: ctx.userId,
          details: { name: token.name },
          organizationId: ctx.organizationId,
        },
      });

      return { success: true };
    }),

  // Get installation instructions using registration token (new flow)
  getBootstrapInstructions: protectedProcedure.query(async ({ ctx: _ctx }) => {
    const saasEndpoint = process.env.NEXTAUTH_URL ?? "https://policy-hub.example.com";

    const helmInstall = `# Add the Policy Hub Helm repository
helm repo add policy-hub https://charts.policy-hub.io
helm repo update

# Create namespace
kubectl create namespace policy-hub-system

# Create secret with registration token
# Replace <REGISTRATION_TOKEN> with your token from the Policy Hub UI
kubectl create secret generic policy-hub-registration \\
  --namespace policy-hub-system \\
  --from-literal=registration-token=<REGISTRATION_TOKEN>

# Install the operator with bootstrap mode
# The operator will automatically register and create the cluster
helm install policy-hub-operator policy-hub/operator \\
  --namespace policy-hub-system \\
  --set config.saasEndpoint=${saasEndpoint} \\
  --set config.clusterName=my-cluster \\
  --set config.bootstrapMode=true \\
  --set config.registrationTokenSecretRef.name=policy-hub-registration \\
  --set config.registrationTokenSecretRef.key=registration-token`;

    const kubectlApply = `# Create namespace
kubectl create namespace policy-hub-system

# Create secret with registration token
# Replace <REGISTRATION_TOKEN> with your token from the Policy Hub UI
kubectl create secret generic policy-hub-registration \\
  --namespace policy-hub-system \\
  --from-literal=registration-token=<REGISTRATION_TOKEN>

# Apply the operator manifest
kubectl apply -f https://raw.githubusercontent.com/policy-hub/operator/main/deploy/operator.yaml

# Create the configuration for bootstrap mode
# Replace "my-cluster" with your desired cluster name
cat <<EOF | kubectl apply -f -
apiVersion: policyhub.io/v1alpha1
kind: PolicyHubConfig
metadata:
  name: policy-hub-config
  namespace: policy-hub-system
spec:
  saasEndpoint: ${saasEndpoint}
  clusterName: my-cluster
  registrationTokenSecretRef:
    name: policy-hub-registration
    key: registration-token
  syncInterval: 30s
  heartbeatInterval: 60s
EOF`;

    return {
      saasEndpoint,
      helmInstall,
      kubectlApply,
    };
  }),
});
