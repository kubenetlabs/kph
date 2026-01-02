import "~/styles/globals.css";

import { type Metadata } from "next";
import { Providers } from "~/providers";

export const metadata: Metadata = {
  title: "Kubernetes Policy Hub",
  description: "Unified policy management for cloud-native infrastructure",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
