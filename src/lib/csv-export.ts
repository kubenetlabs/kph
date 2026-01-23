/**
 * CSV Export Utilities
 *
 * Provides functions for exporting data to CSV format with proper escaping
 * and download functionality.
 */

/**
 * Escapes a value for CSV format
 * - Wraps in quotes if contains comma, quote, or newline
 * - Doubles any existing quotes
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);

  // Check if value needs quoting
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Converts an array of objects to CSV string
 */
export function convertToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  if (data.length === 0) {
    return columns.map((c) => escapeCsvValue(c.header)).join(",");
  }

  // Header row
  const headerRow = columns.map((c) => escapeCsvValue(c.header)).join(",");

  // Data rows
  const dataRows = data.map((row) =>
    columns.map((col) => escapeCsvValue(row[col.key])).join(",")
  );

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Downloads CSV content as a file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Formats a date for CSV export
 */
export function formatDateForCSV(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString();
}

// Type definitions for export columns
export interface ExportColumn<T> {
  key: keyof T;
  header: string;
}

// Pre-defined export configurations

export const clusterExportColumns = [
  { key: "name" as const, header: "Name" },
  { key: "description" as const, header: "Description" },
  { key: "provider" as const, header: "Provider" },
  { key: "region" as const, header: "Region" },
  { key: "environment" as const, header: "Environment" },
  { key: "status" as const, header: "Status" },
  { key: "nodeCount" as const, header: "Node Count" },
  { key: "namespaceCount" as const, header: "Namespace Count" },
  { key: "kubernetesVersion" as const, header: "K8s Version" },
  { key: "operatorInstalled" as const, header: "Operator Installed" },
  { key: "operatorVersion" as const, header: "Operator Version" },
  { key: "lastHeartbeat" as const, header: "Last Heartbeat" },
  { key: "createdAt" as const, header: "Created At" },
];

export const policyExportColumns = [
  { key: "name" as const, header: "Name" },
  { key: "description" as const, header: "Description" },
  { key: "type" as const, header: "Type" },
  { key: "status" as const, header: "Status" },
  { key: "clusterName" as const, header: "Cluster" },
  { key: "targetNamespaces" as const, header: "Target Namespaces" },
  { key: "version" as const, header: "Version" },
  { key: "createdAt" as const, header: "Created At" },
  { key: "updatedAt" as const, header: "Updated At" },
];

export const auditLogExportColumns = [
  { key: "timestamp" as const, header: "Timestamp" },
  { key: "action" as const, header: "Action" },
  { key: "resourceType" as const, header: "Resource Type" },
  { key: "resourceId" as const, header: "Resource ID" },
  { key: "resourceName" as const, header: "Resource Name" },
  { key: "userId" as const, header: "User ID" },
  { key: "userEmail" as const, header: "User Email" },
  { key: "ipAddress" as const, header: "IP Address" },
  { key: "details" as const, header: "Details" },
];
