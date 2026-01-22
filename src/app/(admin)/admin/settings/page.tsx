"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

// Known system configuration keys with their metadata
const CONFIG_DEFINITIONS: Record<string, {
  label: string;
  description: string;
  type: "boolean" | "number" | "string" | "json";
  defaultValue: unknown;
}> = {
  "auth.allowPublicSignup": {
    label: "Allow Public Signup",
    description: "Allow users to sign up without an invitation",
    type: "boolean",
    defaultValue: false,
  },
  "auth.requireEmailVerification": {
    label: "Require Email Verification",
    description: "Require email verification before accessing the platform",
    type: "boolean",
    defaultValue: true,
  },
  "cluster.maxPerOrganization": {
    label: "Max Clusters per Organization",
    description: "Maximum number of clusters an organization can register (0 = unlimited)",
    type: "number",
    defaultValue: 0,
  },
  "cluster.defaultTokenExpiryDays": {
    label: "Default Token Expiry (days)",
    description: "Default expiry period for new agent tokens (0 = never expires)",
    type: "number",
    defaultValue: 365,
  },
  "invitation.expiryDays": {
    label: "Invitation Expiry (days)",
    description: "Number of days before invitations expire",
    type: "number",
    defaultValue: 7,
  },
  "telemetry.retentionDays": {
    label: "Telemetry Retention (days)",
    description: "How long to keep telemetry data before cleanup",
    type: "number",
    defaultValue: 90,
  },
  "simulation.maxConcurrent": {
    label: "Max Concurrent Simulations",
    description: "Maximum number of simulations that can run concurrently per cluster",
    type: "number",
    defaultValue: 3,
  },
  "feature.marketplace": {
    label: "Enable Marketplace",
    description: "Enable the policy pack marketplace feature",
    type: "boolean",
    defaultValue: true,
  },
  "feature.aiPolicyGeneration": {
    label: "Enable AI Policy Generation",
    description: "Enable AI-powered policy generation feature",
    type: "boolean",
    defaultValue: true,
  },
};

export default function AdminSettingsPage() {
  const utils = trpc.useUtils();
  const { data: configs, isLoading } = trpc.admin.getSystemConfig.useQuery();
  const updateConfig = trpc.admin.updateSystemConfig.useMutation({
    onSuccess: () => {
      void utils.admin.getSystemConfig.invalidate();
    },
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Convert configs array to a map for easy lookup
  const configMap = new Map(
    (Array.isArray(configs) ? configs : []).map((c) => [c.key, c.value])
  );

  const handleEdit = (key: string, currentValue: unknown) => {
    setEditingKey(key);
    setEditValue(
      typeof currentValue === "object"
        ? JSON.stringify(currentValue, null, 2)
        : String(currentValue)
    );
  };

  const handleSave = async (key: string, type: string) => {
    let parsedValue: unknown;

    try {
      if (type === "boolean") {
        parsedValue = editValue.toLowerCase() === "true";
      } else if (type === "number") {
        parsedValue = Number(editValue);
        if (isNaN(parsedValue as number)) {
          throw new Error("Invalid number");
        }
      } else if (type === "json") {
        parsedValue = JSON.parse(editValue);
      } else {
        parsedValue = editValue;
      }

      await updateConfig.mutateAsync({
        key,
        value: parsedValue as string | number | boolean | Record<string, unknown> | unknown[]
      });
      setEditingKey(null);
    } catch {
      alert("Invalid value format");
    }
  };

  const handleCancel = () => {
    setEditingKey(null);
    setEditValue("");
  };

  const toggleBoolean = async (key: string, currentValue: boolean) => {
    await updateConfig.mutateAsync({ key, value: !currentValue });
  };

  // Group configs by category
  const categories = {
    Authentication: ["auth.allowPublicSignup", "auth.requireEmailVerification"],
    Clusters: ["cluster.maxPerOrganization", "cluster.defaultTokenExpiryDays"],
    Invitations: ["invitation.expiryDays"],
    Data: ["telemetry.retentionDays", "simulation.maxConcurrent"],
    Features: ["feature.marketplace", "feature.aiPolicyGeneration"],
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
        <p className="mt-1 text-muted">
          Configure platform-wide settings and feature flags
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-muted">Loading settings...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(categories).map(([category, keys]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{category}</CardTitle>
                <CardDescription>
                  {category === "Authentication" && "Control how users access the platform"}
                  {category === "Clusters" && "Manage cluster registration limits and defaults"}
                  {category === "Invitations" && "Configure invitation behavior"}
                  {category === "Data" && "Data retention and processing settings"}
                  {category === "Features" && "Enable or disable platform features"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {keys.map((key) => {
                    const def = CONFIG_DEFINITIONS[key];
                    if (!def) return null;

                    const currentValue = configMap.get(key) ?? def.defaultValue;
                    const isEditing = editingKey === key;

                    return (
                      <div
                        key={key}
                        className="flex items-start justify-between border-b border-card-border pb-4 last:border-0 last:pb-0"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">{def.label}</p>
                            <Badge variant="muted" className="text-xs">
                              {key}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted">{def.description}</p>
                        </div>

                        <div className="ml-4 flex items-center gap-2">
                          {def.type === "boolean" ? (
                            <button
                              onClick={() => toggleBoolean(key, currentValue as boolean)}
                              disabled={updateConfig.isPending}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                currentValue ? "bg-primary" : "bg-muted/30"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  currentValue ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          ) : isEditing ? (
                            <div className="flex items-center gap-2">
                              {def.type === "json" ? (
                                <textarea
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="h-24 w-48 rounded-md border border-card-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
                                />
                              ) : (
                                <input
                                  type={def.type === "number" ? "number" : "text"}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-24 rounded-md border border-card-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
                                />
                              )}
                              <Button
                                size="sm"
                                onClick={() => handleSave(key, def.type)}
                                disabled={updateConfig.isPending}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleCancel}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono text-foreground">
                                {String(currentValue)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEdit(key, currentValue)}
                              >
                                Edit
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Danger Zone */}
          <Card className="border-red-900/50">
            <CardHeader>
              <CardTitle className="text-red-400">Danger Zone</CardTitle>
              <CardDescription>
                Destructive actions that affect the entire platform
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Clear Audit Logs</p>
                    <p className="text-sm text-muted">
                      Permanently delete all audit logs older than 90 days
                    </p>
                  </div>
                  <Button variant="danger" size="sm" disabled>
                    Clear Logs
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Purge Expired Invitations</p>
                    <p className="text-sm text-muted">
                      Delete all expired invitations from the database
                    </p>
                  </div>
                  <Button variant="danger" size="sm" disabled>
                    Purge
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
