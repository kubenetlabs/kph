"use client";

import { cn } from "~/lib/utils";
import Button from "~/components/ui/button";

export interface PaginationProps {
  /** Current page number (1-indexed) */
  page: number;
  /** Total number of pages (optional - for display only) */
  totalPages?: number;
  /** Whether there's a next page available */
  hasNextPage: boolean;
  /** Whether there's a previous page available */
  hasPrevPage: boolean;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Items per page for display */
  pageSize?: number;
  /** Total items count (optional - for display only) */
  totalItems?: number;
  /** Additional className */
  className?: string;
  /** Show page size info */
  showPageInfo?: boolean;
}

export function Pagination({
  page,
  totalPages,
  hasNextPage,
  hasPrevPage,
  onPageChange,
  pageSize = 50,
  totalItems,
  className,
  showPageInfo = true,
}: PaginationProps) {
  const handlePrev = () => {
    if (hasPrevPage) {
      onPageChange(page - 1);
    }
  };

  const handleNext = () => {
    if (hasNextPage) {
      onPageChange(page + 1);
    }
  };

  // Calculate display range
  const startItem = (page - 1) * pageSize + 1;
  const endItem = totalItems
    ? Math.min(page * pageSize, totalItems)
    : page * pageSize;

  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-card-border px-4 py-3",
        className
      )}
    >
      {/* Page Info */}
      {showPageInfo && (
        <div className="text-sm text-muted">
          {totalItems !== undefined ? (
            <>
              Showing <span className="font-medium text-foreground">{startItem}</span>
              {" - "}
              <span className="font-medium text-foreground">{endItem}</span>
              {" of "}
              <span className="font-medium text-foreground">{totalItems}</span>
            </>
          ) : (
            <>
              Page <span className="font-medium text-foreground">{page}</span>
              {totalPages !== undefined && (
                <>
                  {" of "}
                  <span className="font-medium text-foreground">{totalPages}</span>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handlePrev}
          disabled={!hasPrevPage}
          aria-label="Previous page"
        >
          <svg
            className="mr-1 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleNext}
          disabled={!hasNextPage}
          aria-label="Next page"
        >
          Next
          <svg
            className="ml-1 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}

export default Pagination;
