"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { TRPCProvider } from "./trpc-provider";
import { ThemeProvider } from "~/components/theme/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ThemeProvider defaultTheme="dark">
        <TRPCProvider>{children}</TRPCProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
