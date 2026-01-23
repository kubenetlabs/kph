"use client";

import { MoonIcon, SunIcon, ComputerDesktopIcon } from "@heroicons/react/24/outline";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({ showLabel = false, className = "" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const themes = ["light", "dark", "system"] as const;
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]!);
  };

  const getIcon = () => {
    switch (theme) {
      case "light":
        return <SunIcon className="h-4 w-4" aria-hidden="true" />;
      case "dark":
        return <MoonIcon className="h-4 w-4" aria-hidden="true" />;
      case "system":
        return <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />;
    }
  };

  const getLabel = () => {
    switch (theme) {
      case "light":
        return "Light";
      case "dark":
        return "Dark";
      case "system":
        return "System";
    }
  };

  return (
    <button
      onClick={cycleTheme}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-card hover:text-foreground focus:outline-none focus:ring-[3px] focus:ring-primary/50 ${className}`}
      aria-label={`Current theme: ${getLabel()}. Click to switch theme.`}
      title={`Theme: ${getLabel()}`}
    >
      {getIcon()}
      {showLabel && <span>{getLabel()}</span>}
    </button>
  );
}

export function ThemeSelect({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`flex items-center gap-1 rounded-md bg-card border border-card-border p-1 ${className}`}>
      <button
        onClick={() => setTheme("light")}
        className={`rounded p-1.5 transition-colors ${
          theme === "light"
            ? "bg-primary text-primary-foreground"
            : "text-muted hover:text-foreground hover:bg-card-hover"
        }`}
        aria-label="Light mode"
        aria-pressed={theme === "light"}
      >
        <SunIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`rounded p-1.5 transition-colors ${
          theme === "dark"
            ? "bg-primary text-primary-foreground"
            : "text-muted hover:text-foreground hover:bg-card-hover"
        }`}
        aria-label="Dark mode"
        aria-pressed={theme === "dark"}
      >
        <MoonIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setTheme("system")}
        className={`rounded p-1.5 transition-colors ${
          theme === "system"
            ? "bg-primary text-primary-foreground"
            : "text-muted hover:text-foreground hover:bg-card-hover"
        }`}
        aria-label="System preference"
        aria-pressed={theme === "system"}
      >
        <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
