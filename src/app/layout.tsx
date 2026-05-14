import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaHub } from "@/components/PwaHub";
import { RegisterPWA } from "@/components/RegisterPWA";

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
  themeColor: "#aa1f2a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <RegisterPWA />
        <PwaHub />
        {children}
      </body>
    </html>
  );
}
