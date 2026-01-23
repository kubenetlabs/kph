"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { trpc } from "~/lib/trpc";

interface ProcessEventsPanelProps {
  clusterId: string;
  timeRange: "5m" | "15m" | "1h" | "24h";
}

const categoryConfig = {
  shell: { label: "Shell", variant: "danger" as const, icon: "terminal" },
  network_tool: { label: "Network Tool", variant: "warning" as const, icon: "globe" },
  scripting: { label: "Scripting", variant: "tetragon" as const, icon: "code" },
  system: { label: "System", variant: "muted" as const, icon: "cog" },
  file_reader: { label: "File Reader", variant: "warning" as const, icon: "file" },
  normal: { label: "Normal", variant: "muted" as const, icon: "check" },
};

export function ProcessEventsPanel({ clusterId, timeRange }: ProcessEventsPanelProps) {
  const router = useRouter();
  const [showOnlySuspicious, setShowOnlySuspicious] = useState(true);
  const [expandedPod, setExpandedPod] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.topology.getProcessEvents.useQuery(
    {
      clusterId,
      timeRange,
      suspicious: showOnlySuspicious,
    },
    {
      enabled: !!clusterId,
      refetchInterval: 30000, // Refresh every 30s
    }
  );

  const handleGeneratePolicy = (namespace: string, processName: string, category: string) => {
    // Build a natural language prompt based on the event type
    // IMPORTANT: Use matchArgs with Postfix operator - this is the proven working approach
    let prompt = "";

    switch (category) {
      case "shell":
        prompt = `Create a Tetragon TracingPolicyNamespaced for the ${namespace} namespace that blocks shell execution.

The structure must be EXACTLY like this:
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /sh
        - /bash
        - /zsh
        - /dash
        - /ash
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;
        break;
      case "network_tool":
        prompt = `Create a Tetragon TracingPolicyNamespaced for the ${namespace} namespace that blocks network tools.

The structure must be EXACTLY like this:
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /curl
        - /wget
        - /nc
        - /netcat
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;
        break;
      case "scripting":
        prompt = `Create a Tetragon TracingPolicyNamespaced for the ${namespace} namespace that blocks scripting interpreters.

The structure must be EXACTLY like this:
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /perl
        - /python
        - /python3
        - /ruby
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;
        break;
      case "file_reader":
        prompt = `Create a Tetragon TracingPolicyNamespaced for the ${namespace} namespace that blocks reading sensitive files.

The structure must use kprobes to monitor file read syscalls and block access to sensitive paths like /etc/shadow, /etc/passwd, and /var/run/secrets.

spec:
  kprobes:
  - call: sys_openat
    syscall: true
    args:
    - index: 1
      type: string
    selectors:
    - matchArgs:
      - index: 1
        operator: Prefix
        values:
        - /etc/shadow
        - /etc/passwd
        - /etc/sudoers
        - /var/run/secrets
        - /root/.ssh
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;
        break;
      default:
        prompt = `Create a Tetragon TracingPolicyNamespaced for the ${namespace} namespace that blocks ${processName}.

Use this structure:
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /${processName.split('/').pop()}
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;
    }

    // Navigate to policy generation page with pre-filled prompt
    const params = new URLSearchParams({
      prompt: encodeURIComponent(prompt),
      type: "TETRAGON",
      namespace: namespace,
    });
    router.push(`/policies/generate?${params.toString()}`);
  };

  const handleGeneratePolicyForAll = () => {
    if (!data?.podGroups.length) return;

    // Get unique namespaces with suspicious activity
    const namespaces = [...new Set(data.podGroups.map((pg) => pg.namespace))];
    const ns = namespaces[0] ?? "default";

    const prompt = `Create a Tetragon TracingPolicyNamespaced for the ${ns} namespace that provides comprehensive runtime security.

The structure must be EXACTLY like this:
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /sh
        - /bash
        - /zsh
        - /dash
        - /ash
        - /curl
        - /wget
        - /nc
        - /netcat
        - /perl
        - /python
        - /python3
        - /ruby
      matchActions:
      - action: Sigkill

Do NOT use matchBinaries or matchNamespaces.`;

    const params = new URLSearchParams({
      prompt: encodeURIComponent(prompt),
      type: "TETRAGON",
      namespace: ns,
    });
    router.push(`/policies/generate?${params.toString()}`);
  };

  if (!clusterId) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2">
              <svg className="h-5 w-5 text-tetragon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              Runtime Security Events
            </CardTitle>
            <Badge variant="tetragon">Tetragon</Badge>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle suspicious only */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlySuspicious}
                onChange={(e) => setShowOnlySuspicious(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-muted">Suspicious only</span>
            </label>

            {/* Refresh button */}
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </Button>

            {/* Generate policy for all */}
            {data && data.summary.suspiciousEvents > 0 && (
              <Button size="sm" onClick={handleGeneratePolicyForAll}>
                <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Generate Protection Policy
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" variant="tetragon" />
          </div>
        )}

        {!isLoading && data && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-6 gap-4 mb-4">
              <div className="bg-card-hover rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{data.summary.totalEvents}</p>
                <p className="text-xs text-muted">Total Events</p>
              </div>
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-danger">{data.summary.shellExecutions}</p>
                <p className="text-xs text-danger">Shell Executions</p>
              </div>
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-warning">{data.summary.networkTools}</p>
                <p className="text-xs text-warning">Network Tools</p>
              </div>
              <div className="bg-tetragon/10 border border-tetragon/30 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-tetragon">{data.summary.scriptingLanguages}</p>
                <p className="text-xs text-tetragon">Scripting</p>
              </div>
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-warning">{data.summary.fileReaders ?? 0}</p>
                <p className="text-xs text-warning">File Readers</p>
              </div>
              <div className="bg-card-hover rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{data.summary.uniquePods}</p>
                <p className="text-xs text-muted">Affected Pods</p>
              </div>
            </div>

            {/* Events by Pod */}
            {data.podGroups.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-border rounded-lg">
                <svg className="mx-auto h-12 w-12 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-2 text-muted">No suspicious process events detected</p>
                <p className="text-sm text-muted">
                  {showOnlySuspicious ? "Try disabling the 'Suspicious only' filter" : "Runtime security is looking good!"}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {data.podGroups.map((podGroup) => (
                  <div
                    key={podGroup.key}
                    className="border border-border rounded-lg overflow-hidden"
                  >
                    {/* Pod Header */}
                    <button
                      onClick={() => setExpandedPod(expandedPod === podGroup.key ? null : podGroup.key)}
                      className="w-full flex items-center justify-between p-3 bg-card hover:bg-card-hover transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          className={`h-4 w-4 text-muted transition-transform ${expandedPod === podGroup.key ? "rotate-90" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div>
                          <span className="font-medium text-foreground">{podGroup.podName}</span>
                          <span className="text-muted text-sm ml-2">({podGroup.namespace})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {podGroup.suspiciousCount > 0 && (
                          <Badge variant="danger">{podGroup.suspiciousCount} suspicious</Badge>
                        )}
                        <span className="text-sm text-muted">{podGroup.events.length} events</span>
                      </div>
                    </button>

                    {/* Expanded Events */}
                    {expandedPod === podGroup.key && (
                      <div className="border-t border-border bg-background">
                        <div className="divide-y divide-border">
                          {podGroup.events.slice(0, 10).map((event) => {
                            const config = categoryConfig[event.category];
                            return (
                              <div
                                key={event.id}
                                className="flex items-center justify-between p-3 hover:bg-card-hover"
                              >
                                <div className="flex items-center gap-3">
                                  <Badge variant={config.variant}>{config.label}</Badge>
                                  <code className="text-sm font-mono text-foreground">{event.processName}</code>
                                  <span className="text-xs text-muted">
                                    x{event.execCount}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted">
                                    {new Date(event.timestamp).toLocaleTimeString()}
                                  </span>
                                  {event.isSuspicious && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleGeneratePolicy(event.namespace, event.processName, event.category)}
                                      title="Generate Tetragon policy to block this"
                                    >
                                      <svg className="h-4 w-4 text-tetragon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                      </svg>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {podGroup.events.length > 10 && (
                            <div className="p-2 text-center text-sm text-muted">
                              +{podGroup.events.length - 10} more events
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
