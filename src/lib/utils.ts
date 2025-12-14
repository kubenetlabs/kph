import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date with time
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d);
}

/**
 * Format large numbers with K/M suffix
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Get status color class based on status string
 */
export function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    // Cluster statuses
    CONNECTED: "text-success",
    PENDING: "text-warning",
    DEGRADED: "text-warning",
    DISCONNECTED: "text-danger",
    ERROR: "text-danger",
    
    // Policy statuses
    DRAFT: "text-muted",
    SIMULATING: "text-accent-light",
    DEPLOYED: "text-success",
    FAILED: "text-danger",
    ARCHIVED: "text-muted",
    
    // Simulation statuses
    RUNNING: "text-accent-light",
    COMPLETED: "text-success",
    CANCELLED: "text-muted",
  };
  
  return statusColors[status] ?? "text-muted";
}

/**
 * Get status badge class
 */
export function getStatusBadge(status: string): string {
  const badgeClasses: Record<string, string> = {
    CONNECTED: "badge-success",
    DEPLOYED: "badge-success",
    COMPLETED: "badge-success",
    PENDING: "badge-warning",
    DEGRADED: "badge-warning",
    SIMULATING: "badge-accent",
    RUNNING: "badge-accent",
    DRAFT: "badge-muted",
    ARCHIVED: "badge-muted",
    CANCELLED: "badge-muted",
    DISCONNECTED: "badge-danger",
    ERROR: "badge-danger",
    FAILED: "badge-danger",
  };
  
  return badgeClasses[status] ?? "badge-muted";
}

/**
 * Get policy type badge class
 */
export function getPolicyTypeBadge(type: string): string {
  if (type.startsWith("CILIUM")) return "badge-cilium";
  if (type === "TETRAGON") return "badge-tetragon";
  if (type.startsWith("GATEWAY")) return "badge-gateway";
  return "badge-muted";
}

/**
 * Get policy type display name
 */
export function getPolicyTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    CILIUM_NETWORK: "Cilium Network Policy",
    CILIUM_CLUSTERWIDE: "Cilium Clusterwide Policy",
    TETRAGON: "Tetragon Tracing Policy",
    GATEWAY_HTTPROUTE: "Gateway HTTPRoute",
    GATEWAY_GRPCROUTE: "Gateway gRPCRoute",
    GATEWAY_TCPROUTE: "Gateway TCPRoute",
  };
  return labels[type] ?? type;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Generate a slug from a string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Delay for async operations
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
