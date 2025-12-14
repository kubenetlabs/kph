import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "~/lib/utils";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "accent"
  | "policyhub"
  | "cilium"
  | "tetragon"
  | "gateway";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variants: Record<BadgeVariant, string> = {
      default: "bg-card text-foreground border border-card-border",
      success: "bg-success/20 text-success",
      warning: "bg-warning/20 text-warning",
      danger: "bg-danger/20 text-danger",
      muted: "bg-muted/20 text-muted",
      accent: "bg-accent/20 text-accent-light",
      policyhub: "bg-policyhub/20 text-policyhub",
      cilium: "bg-cilium/20 text-cilium",
      tetragon: "bg-tetragon/20 text-tetragon",
      gateway: "bg-gateway/20 text-gateway",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";

export default Badge;
