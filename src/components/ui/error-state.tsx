"use client";

import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}

export function ErrorState({
  title = "Something went wrong",
  message = "An error occurred while loading this content.",
  onRetry,
  retryLabel = "Try again",
  className = "",
  compact = false,
}: ErrorStateProps) {
  if (compact) {
    return (
      <div className={`flex items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 ${className}`}>
        <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0 text-danger" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-danger">{title}</p>
          {message && <p className="text-xs text-danger/80 truncate">{message}</p>}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-md bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/30 focus:outline-none focus:ring-2 focus:ring-danger/50"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/10 mb-4">
        <ExclamationTriangleIcon className="h-8 w-8 text-danger" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted max-w-md mb-6">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger-dark focus:outline-none focus:ring-2 focus:ring-danger/50 focus:ring-offset-2 focus:ring-offset-background"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

interface QueryErrorStateProps {
  error: unknown;
  refetch?: () => void;
  className?: string;
  compact?: boolean;
}

export function QueryErrorState({ error, refetch, className, compact }: QueryErrorStateProps) {
  const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";

  return (
    <ErrorState
      title="Failed to load data"
      message={errorMessage}
      onRetry={refetch}
      retryLabel="Retry"
      className={className}
      compact={compact}
    />
  );
}
