import { cn } from "~/lib/utils";
import { Card } from "~/components/ui/card";

interface MetricCardProps {
  label: string;
  value: string | number;
  detail?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: React.ReactNode;
  className?: string;
}

export default function MetricCard({
  label,
  value,
  detail,
  trend,
  icon,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold text-primary">{value}</p>
          {detail && (
            <p className="mt-1 text-sm text-muted">{detail}</p>
          )}
          {trend && (
            <p
              className={cn(
                "mt-2 text-xs font-medium",
                trend.isPositive ? "text-success" : "text-danger"
              )}
            >
              {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
              <span className="text-muted"> vs last month</span>
            </p>
          )}
        </div>
        {icon && (
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
