"use client";

import { useState } from "react";
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";

export type SortDirection = "asc" | "desc" | null;

export interface SortState<T extends string> {
  column: T | null;
  direction: SortDirection;
}

interface SortableHeaderProps<T extends string> {
  column: T;
  label: string;
  currentSort: SortState<T>;
  onSort: (column: T) => void;
  className?: string;
}

export function SortableHeader<T extends string>({
  column,
  label,
  currentSort,
  onSort,
  className = "",
}: SortableHeaderProps<T>) {
  const isActive = currentSort.column === column;
  const direction = isActive ? currentSort.direction : null;

  const handleClick = () => {
    onSort(column);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-card ${
        isActive ? "text-foreground" : "text-muted"
      } ${className}`}
      aria-sort={
        direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
      }
    >
      <span>{label}</span>
      <span className="flex-shrink-0" aria-hidden="true">
        {direction === "asc" ? (
          <ChevronUpIcon className="h-4 w-4 text-primary" />
        ) : direction === "desc" ? (
          <ChevronDownIcon className="h-4 w-4 text-primary" />
        ) : (
          <ChevronUpDownIcon className="h-4 w-4 text-muted group-hover:text-foreground" />
        )}
      </span>
    </button>
  );
}

export function useSortState<T extends string>(defaultColumn?: T, defaultDirection: SortDirection = "asc") {
  const [sortState, setSortState] = useState<SortState<T>>({
    column: defaultColumn ?? null,
    direction: defaultColumn ? defaultDirection : null,
  });

  const handleSort = (column: T) => {
    setSortState((prev) => {
      if (prev.column === column) {
        // Cycle: asc -> desc -> null
        if (prev.direction === "asc") {
          return { column, direction: "desc" };
        } else if (prev.direction === "desc") {
          return { column: null, direction: null };
        }
      }
      // New column or was null, start with asc
      return { column, direction: "asc" };
    });
  };

  return { sortState, handleSort };
}

// Helper to sort an array based on sort state
export function sortData<T, K extends string>(
  data: T[],
  sortState: SortState<K>,
  getters: Record<K, (item: T) => string | number | Date | null | undefined>
): T[] {
  if (!sortState.column || !sortState.direction) {
    return data;
  }

  const getter = getters[sortState.column];
  if (!getter) {
    return data;
  }

  const direction = sortState.direction === "asc" ? 1 : -1;

  return [...data].sort((a, b) => {
    const aVal = getter(a);
    const bVal = getter(b);

    // Handle null/undefined values
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return direction;
    if (bVal == null) return -direction;

    // Compare based on type
    if (typeof aVal === "string" && typeof bVal === "string") {
      return direction * aVal.localeCompare(bVal);
    }

    if (aVal instanceof Date && bVal instanceof Date) {
      return direction * (aVal.getTime() - bVal.getTime());
    }

    if (typeof aVal === "number" && typeof bVal === "number") {
      return direction * (aVal - bVal);
    }

    // Fallback to string comparison
    return direction * String(aVal).localeCompare(String(bVal));
  });
}

