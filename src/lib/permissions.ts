/**
 * RBAC Permission Helpers for Kubernetes Policy Hub
 *
 * Role Hierarchy:
 *   SuperAdmin (platform-wide) - checked via isSuperAdmin boolean
 *       |
 *       +-- OrgAdmin (organization-scoped)
 *               |
 *               +-- ClusterAdmin (cluster-scoped via ClusterAssignment)
 *                       |
 *                       +-- PolicyEditor (cluster-scoped via ClusterAssignment)
 *                               |
 *                               +-- Viewer
 */

import type { Role, User } from "@prisma/client";
import { db } from "./db";

/**
 * Numeric hierarchy for role comparison
 * Higher number = more permissions
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  ORG_ADMIN: 40,
  CLUSTER_ADMIN: 30,
  POLICY_EDITOR: 20,
  VIEWER: 10,
};

/**
 * Type for user with minimal fields needed for permission checks
 */
export type PermissionUser = Pick<User, "id" | "isSuperAdmin" | "newRole" | "organizationId">;

/**
 * Check if user has at least the specified role level (organization-scoped)
 *
 * @param userRole - The user's current role
 * @param requiredRole - The minimum required role
 * @returns true if user's role >= required role
 */
export function hasMinRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if user can access a specific cluster with the required permission level
 *
 * Access is granted if:
 * 1. User is a SuperAdmin (platform-wide access)
 * 2. User is an OrgAdmin (org-wide access to all clusters)
 * 3. User has a ClusterAssignment with sufficient role for that cluster
 *
 * @param user - The user to check
 * @param clusterId - The cluster to check access for
 * @param minRole - Minimum required role for this action
 * @returns true if user has sufficient access
 */
export async function checkClusterAccess(
  user: PermissionUser,
  clusterId: string,
  minRole: Role
): Promise<boolean> {
  // SuperAdmins can access all clusters
  if (user.isSuperAdmin) {
    return true;
  }

  // OrgAdmins can access all clusters in their organization
  if (user.newRole === "ORG_ADMIN") {
    // Verify the cluster belongs to the user's organization
    const cluster = await db.cluster.findUnique({
      where: { id: clusterId },
      select: { organizationId: true },
    });
    return cluster?.organizationId === user.organizationId;
  }

  // For other roles, check ClusterAssignment
  const assignment = await db.clusterAssignment.findUnique({
    where: {
      userId_clusterId: {
        userId: user.id,
        clusterId,
      },
    },
  });

  if (!assignment) {
    return false;
  }

  return hasMinRole(assignment.role, minRole);
}

/**
 * Get all clusters a user can access with at least the specified role
 *
 * @param user - The user to check
 * @param minRole - Minimum required role (optional, defaults to VIEWER)
 * @returns Array of cluster IDs the user can access
 */
export async function getAccessibleClusterIds(
  user: PermissionUser,
  minRole: Role = "VIEWER"
): Promise<string[]> {
  // SuperAdmins can access all clusters
  if (user.isSuperAdmin) {
    const clusters = await db.cluster.findMany({
      select: { id: true },
    });
    return clusters.map((c) => c.id);
  }

  // OrgAdmins can access all clusters in their organization
  if (user.newRole === "ORG_ADMIN" && user.organizationId) {
    const clusters = await db.cluster.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return clusters.map((c) => c.id);
  }

  // For other roles, get clusters from ClusterAssignments
  const minLevel = ROLE_HIERARCHY[minRole];
  const assignments = await db.clusterAssignment.findMany({
    where: {
      userId: user.id,
    },
    select: {
      clusterId: true,
      role: true,
    },
  });

  return assignments
    .filter((a) => ROLE_HIERARCHY[a.role] >= minLevel)
    .map((a) => a.clusterId);
}

/**
 * Check if user can perform organization-level actions
 *
 * @param user - The user to check
 * @param organizationId - The organization to check access for
 * @param minRole - Minimum required role
 * @returns true if user has sufficient access
 */
export function canAccessOrganization(
  user: PermissionUser,
  organizationId: string,
  minRole: Role
): boolean {
  // SuperAdmins can access any organization
  if (user.isSuperAdmin) {
    return true;
  }

  // User must belong to the organization
  if (user.organizationId !== organizationId) {
    return false;
  }

  return hasMinRole(user.newRole, minRole);
}

/**
 * Type guard to check if user is a SuperAdmin
 */
export function isSuperAdmin(user: Pick<User, "isSuperAdmin">): boolean {
  return user.isSuperAdmin === true;
}

/**
 * Get the effective role for a user on a specific cluster
 * Returns the highest applicable role
 *
 * @param user - The user to check
 * @param clusterId - The cluster to check
 * @returns The effective role, or null if no access
 */
export async function getEffectiveClusterRole(
  user: PermissionUser,
  clusterId: string
): Promise<Role | "SUPER_ADMIN" | null> {
  // SuperAdmins have special access level
  if (user.isSuperAdmin) {
    return "SUPER_ADMIN";
  }

  // OrgAdmins have ORG_ADMIN level on all org clusters
  if (user.newRole === "ORG_ADMIN") {
    const cluster = await db.cluster.findUnique({
      where: { id: clusterId },
      select: { organizationId: true },
    });
    if (cluster?.organizationId === user.organizationId) {
      return "ORG_ADMIN";
    }
  }

  // Check cluster assignment
  const assignment = await db.clusterAssignment.findUnique({
    where: {
      userId_clusterId: {
        userId: user.id,
        clusterId,
      },
    },
  });

  return assignment?.role ?? null;
}

/**
 * Audit action types for logging
 */
export type AuditAction =
  | "user.login"
  | "user.logout"
  | "member.invited"
  | "member.joined"
  | "member.updated"
  | "member.removed"
  | "cluster.created"
  | "cluster.connected"
  | "cluster.disconnected"
  | "token.created"
  | "token.revoked"
  | "token.rotated"
  | "policy.created"
  | "policy.updated"
  | "policy.deployed"
  | "policy.rollback"
  | "org.created"
  | "org.updated"
  | "system.config.updated";

/**
 * Context for audit logging
 */
export interface AuditContext {
  user?: { id: string; email: string };
  organizationId?: string;
  clusterId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit event
 */
export async function logAudit(
  ctx: AuditContext,
  action: AuditAction,
  details?: Record<string, unknown>
): Promise<void> {
  await db.auditLog.create({
    data: {
      action,
      userId: ctx.user?.id,
      userEmail: ctx.user?.email,
      organizationId: ctx.organizationId,
      clusterId: ctx.clusterId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      details: details ? (details as object) : undefined,
    },
  });
}
