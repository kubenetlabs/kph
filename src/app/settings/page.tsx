"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";

const settingsSections = [
  {
    title: "Team & Members",
    description: "Manage team members, invitations, and roles",
    href: "/settings/team",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    title: "API Tokens",
    description: "Manage API tokens for programmatic access",
    href: "/clusters",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ),
  },
  {
    title: "Notifications",
    description: "Configure alerts and notification preferences",
    href: "/settings/notifications",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    comingSoon: true,
  },
  {
    title: "Integrations",
    description: "Connect with external tools and services",
    href: "/settings/integrations",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
      </svg>
    ),
    comingSoon: true,
  },
];

export default function SettingsPage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-muted">
          Manage your organization settings and preferences
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {settingsSections.map((section) => (
          <Card
            key={section.title}
            className={`cursor-pointer transition-all hover:border-accent ${
              section.comingSoon ? "opacity-60" : ""
            }`}
            onClick={() => !section.comingSoon && router.push(section.href)}
          >
            <CardContent className="flex items-start gap-4 p-6">
              <div className="rounded-lg bg-card-hover p-3 text-accent">
                {section.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">{section.title}</h3>
                  {section.comingSoon && (
                    <span className="rounded bg-muted/20 px-2 py-0.5 text-xs text-muted">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">{section.description}</p>
              </div>
              {!section.comingSoon && (
                <svg className="h-5 w-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
