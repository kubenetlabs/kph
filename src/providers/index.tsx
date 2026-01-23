"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { TRPCProvider } from "./trpc-provider";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { CommandPalette } from "~/components/command-palette/command-palette";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ThemeProvider defaultTheme="dark">
        <TRPCProvider>
          {children}
          <CommandPalette />
        </TRPCProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
