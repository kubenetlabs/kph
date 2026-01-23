"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface CommandItem {
  id: string;
  name: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
  section: "navigation" | "actions" | "settings";
}

const icons = {
  dashboard: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  clusters: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  policies: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  simulation: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  topology: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  marketplace: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  gateway: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  templates: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  settings: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  plus: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  validation: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  recommendations: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
};

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch("");
    setSelectedIndex(0);
  }, []);

  const commands: CommandItem[] = useMemo(
    () => [
      // Navigation
      {
        id: "dashboard",
        name: "Go to Dashboard",
        icon: icons.dashboard,
        action: () => router.push("/dashboard"),
        keywords: ["home", "overview"],
        section: "navigation",
      },
      {
        id: "clusters",
        name: "Go to Clusters",
        icon: icons.clusters,
        action: () => router.push("/clusters"),
        keywords: ["kubernetes", "k8s"],
        section: "navigation",
      },
      {
        id: "policies",
        name: "Go to Policies",
        icon: icons.policies,
        action: () => router.push("/policies"),
        keywords: ["network", "cilium", "security"],
        section: "navigation",
      },
      {
        id: "templates",
        name: "Go to Templates",
        icon: icons.templates,
        action: () => router.push("/templates"),
        keywords: ["multi-cluster", "sync"],
        section: "navigation",
      },
      {
        id: "gateway",
        name: "Go to Gateway API",
        icon: icons.gateway,
        action: () => router.push("/gateway-api"),
        keywords: ["http", "route", "ingress"],
        section: "navigation",
      },
      {
        id: "topology",
        name: "Go to Topology",
        icon: icons.topology,
        action: () => router.push("/topology"),
        keywords: ["network", "flows", "graph", "visualization"],
        section: "navigation",
      },
      {
        id: "marketplace",
        name: "Go to Marketplace",
        icon: icons.marketplace,
        action: () => router.push("/marketplace"),
        keywords: ["packs", "install", "browse"],
        section: "navigation",
      },
      {
        id: "simulation",
        name: "Go to Simulation",
        icon: icons.simulation,
        action: () => router.push("/simulation"),
        keywords: ["time-travel", "test", "what-if"],
        section: "navigation",
      },
      {
        id: "validation",
        name: "Go to Validation",
        icon: icons.validation,
        action: () => router.push("/validation"),
        keywords: ["verify", "check", "events"],
        section: "navigation",
      },
      {
        id: "recommendations",
        name: "Go to Recommendations",
        icon: icons.recommendations,
        action: () => router.push("/recommendations"),
        keywords: ["suggest", "improve", "gaps"],
        section: "navigation",
      },
      {
        id: "settings",
        name: "Go to Settings",
        icon: icons.settings,
        action: () => router.push("/settings"),
        keywords: ["preferences", "config"],
        section: "navigation",
      },
      // Actions
      {
        id: "new-cluster",
        name: "Add New Cluster",
        description: "Register a new Kubernetes cluster",
        icon: icons.plus,
        action: () => router.push("/clusters/install"),
        keywords: ["create", "register", "add"],
        section: "actions",
      },
      {
        id: "new-policy",
        name: "Create New Policy",
        description: "Create a network or security policy",
        icon: icons.plus,
        action: () => router.push("/policies/new"),
        keywords: ["create", "add", "cilium"],
        section: "actions",
      },
      {
        id: "new-template",
        name: "Create New Template",
        description: "Create a multi-cluster policy template",
        icon: icons.plus,
        action: () => router.push("/templates/new"),
        keywords: ["create", "add"],
        section: "actions",
      },
      {
        id: "new-simulation",
        name: "Start New Simulation",
        description: "Run a time-travel simulation",
        icon: icons.simulation,
        action: () => router.push("/simulation/new"),
        keywords: ["run", "test"],
        section: "actions",
      },
    ],
    [router]
  );

  const filteredCommands = useMemo(() => {
    if (!search) return commands;
    const lowerSearch = search.toLowerCase();
    return commands.filter((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(lowerSearch);
      const descMatch = cmd.description?.toLowerCase().includes(lowerSearch) ?? false;
      const keywordMatch = cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerSearch)) ?? false;
      return nameMatch || descMatch || keywordMatch;
    });
  }, [commands, search]);

  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    filteredCommands.forEach((cmd) => {
      if (!groups[cmd.section]) {
        groups[cmd.section] = [];
      }
      groups[cmd.section]!.push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  const flatCommands = useMemo(
    () => Object.values(groupedCommands).flat(),
    [groupedCommands]
  );

  // Keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // Navigation within the palette
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const selectedCommand = flatCommands[selectedIndex];
        if (selectedCommand) {
          e.preventDefault();
          selectedCommand.action();
          close();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedIndex, flatCommands, close]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  if (!isOpen) return null;

  const sectionLabels: Record<string, string> = {
    navigation: "Navigation",
    actions: "Quick Actions",
    settings: "Settings",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 border-b border-card-border px-4 py-3">
          <MagnifyingGlassIcon className="h-5 w-5 text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search commands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted focus:outline-none"
            autoFocus
          />
          <button
            onClick={close}
            className="rounded p-1 text-muted hover:bg-card-hover hover:text-foreground"
            aria-label="Close command palette"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {flatCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted">
              No commands found for &quot;{search}&quot;
            </div>
          ) : (
            Object.entries(groupedCommands).map(([section, items]) => (
              <div key={section}>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  {sectionLabels[section] ?? section}
                </div>
                {items.map((cmd) => {
                  const globalIndex = flatCommands.indexOf(cmd);
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        cmd.action();
                        close();
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                        globalIndex === selectedIndex
                          ? "bg-primary/10 text-foreground"
                          : "text-muted hover:bg-card-hover hover:text-foreground"
                      }`}
                    >
                      <span className="text-muted">{cmd.icon}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{cmd.name}</div>
                        {cmd.description && (
                          <div className="text-xs text-muted">{cmd.description}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-card-border px-4 py-2 text-xs text-muted">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="rounded bg-card-hover px-1.5 py-0.5 font-mono">↑</kbd>
              <kbd className="ml-1 rounded bg-card-hover px-1.5 py-0.5 font-mono">↓</kbd>
              <span className="ml-1">to navigate</span>
            </span>
            <span>
              <kbd className="rounded bg-card-hover px-1.5 py-0.5 font-mono">Enter</kbd>
              <span className="ml-1">to select</span>
            </span>
          </div>
          <span>
            <kbd className="rounded bg-card-hover px-1.5 py-0.5 font-mono">Esc</kbd>
            <span className="ml-1">to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
