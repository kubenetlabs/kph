import { cn } from "~/lib/utils";

export interface SpinnerProps {
  /** Size of the spinner */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Color variant - uses design system colors */
  variant?: "primary" | "accent" | "current" | "tetragon";
  /** Additional className */
  className?: string;
}

const sizeClasses = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-2",
  xl: "h-10 w-10 border-4",
} as const;

const variantClasses = {
  primary: "border-primary",
  accent: "border-accent",
  current: "border-current",
  tetragon: "border-tetragon",
} as const;

export function Spinner({
  size = "md",
  variant = "primary",
  className,
}: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-spin rounded-full border-t-transparent",
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
    />
  );
}

export default Spinner;
