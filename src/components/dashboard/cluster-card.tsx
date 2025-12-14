import { cn } from "~/lib/utils";
import { Card } from "~/components/ui/card";
import Badge from "~/components/ui/badge";

type ClusterStatus = "CONNECTED" | "PENDING" | "DEGRADED" | "DISCONNECTED" | "ERROR";
type CloudProvider = "AWS" | "GCP" | "AZURE" | "ON_PREM" | "OTHER";

interface ClusterCardProps {
  name: string;
  provider: CloudProvider;
  region: string;
  status: ClusterStatus;
  nodeCount?: number;
  policyCount?: number;
  lastHeartbeat?: Date | null;
  onClick?: () => void;
}

const providerIcons: Record<CloudProvider, React.ReactNode> = {
  AWS: <span className="text-warning font-bold">AWS</span>,
  GCP: <span className="text-accent-light font-bold">GCP</span>,
  AZURE: <span className="text-policyhub font-bold">Azure</span>,
  ON_PREM: <span className="text-muted font-bold">On-Prem</span>,
  OTHER: <span className="text-muted font-bold">Other</span>,
};

const statusBadges: Record<ClusterStatus, { variant: "success" | "warning" | "danger" | "muted"; label: string }> = {
  CONNECTED: { variant: "success", label: "Connected" },
  PENDING: { variant: "warning", label: "Pending" },
  DEGRADED: { variant: "warning", label: "Degraded" },
  DISCONNECTED: { variant: "danger", label: "Disconnected" },
  ERROR: { variant: "danger", label: "Error" },
};

export default function ClusterCard({
  name,
  provider,
  region,
  status,
  nodeCount,
  policyCount,
  lastHeartbeat,
  onClick,
}: ClusterCardProps) {
  const statusInfo = statusBadges[status];

  return (
    <Card
      hover={!!onClick}
      onClick={onClick}
      className="relative"
    >
      {/* Status indicator bar */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-lg",
          status === "CONNECTED" && "bg-success",
          status === "PENDING" && "bg-warning",
          status === "DEGRADED" && "bg-warning",
          (status === "DISCONNECTED" || status === "ERROR") && "bg-danger"
        )}
      />

      <div className="pl-2">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{name}</h3>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted">
              {providerIcons[provider]}
              <span>•</span>
              <span>{region}</span>
            </div>
          </div>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-6">
          {nodeCount !== undefined && (
            <div>
              <p className="text-lg font-semibold text-foreground">{nodeCount}</p>
              <p className="text-xs text-muted">Nodes</p>
            </div>
          )}
          {policyCount !== undefined && (
            <div>
              <p className="text-lg font-semibold text-foreground">{policyCount}</p>
              <p className="text-xs text-muted">Policies</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {lastHeartbeat && (
          <div className="mt-4 border-t border-card-border pt-3">
            <p className="text-xs text-muted">
              Last heartbeat:{" "}
              <span className="text-foreground">
                {new Date(lastHeartbeat).toLocaleTimeString()}
              </span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
