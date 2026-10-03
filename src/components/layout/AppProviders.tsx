"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * FW-7: every client-side provider the app needs, in one place.
 *
 * The theme provider is inside the query client rather than beside it because `next-themes` must not be
 * inside a suspense boundary that can suspend -- it renders an inline script that has to run before the
 * body paints, and a provider that suspends would delay it.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}