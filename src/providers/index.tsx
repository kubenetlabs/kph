"use client";

import { AuthProvider } from "./auth-provider";
import { TRPCProvider } from "./trpc-provider";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { CommandPalette } from "~/components/command-palette/command-palette";
import { TourProvider, TourOverlay } from "~/components/guided-tour";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider defaultTheme="dark">
        <TRPCProvider>
          <TourProvider>
            {children}
            <CommandPalette />
            <TourOverlay />
          </TourProvider>
        </TRPCProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
