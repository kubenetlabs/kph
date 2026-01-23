"use client";

import { useState } from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import Button from "./button";
import { convertToCSV, downloadCSV, type ExportColumn } from "~/lib/csv-export";

interface ExportButtonProps<T extends Record<string, unknown>> {
  data: T[];
  columns: ExportColumn<T>[];
  filename: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
}

export function ExportButton<T extends Record<string, unknown>>({
  data,
  columns,
  filename,
  label = "Export CSV",
  variant = "secondary",
  disabled = false,
  className = "",
}: ExportButtonProps<T>) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = () => {
    setIsExporting(true);

    try {
      const csv = convertToCSV(data, columns);
      const timestamp = new Date().toISOString().split("T")[0];
      downloadCSV(csv, `${filename}-${timestamp}.csv`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant={variant}
      onClick={handleExport}
      disabled={disabled || data.length === 0 || isExporting}
      className={className}
    >
      <ArrowDownTrayIcon className="mr-2 h-4 w-4" aria-hidden="true" />
      {isExporting ? "Exporting..." : label}
    </Button>
  );
}
