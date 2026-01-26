"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { TRPCProvider } from "./trpc-provider";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { CommandPalette } from "~/components/command-palette/command-palette";
import { TourProvider, TourOverlay } from "~/components/guided-tour";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ThemeProvider defaultTheme="dark">
        <TRPCProvider>
          <TourProvider>
            {children}
            <CommandPalette />
            <TourOverlay />
          </TourProvider>
        </TRPCProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
