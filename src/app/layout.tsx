import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterPWA } from "@/components/RegisterPWA";
import { AppProviders } from "@/components/layout/AppProviders";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "KofA Attendance",
  description: "Knights of the Altar Attendance Monitoring",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  appleWebApp: { capable: true, title: "KofA AMS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Matches the page it sits above. These were the old warm palette's values, which painted a
  // dark-maroon status bar over a white page and a maroon one over a black one -- the exact bars that
  // are most visible on a phone.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <RegisterPWA />
        <AppProviders>{children}</AppProviders>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
