"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * FW-7: the theme provider.
 *
 * `next-themes` writes the choice to `localStorage` and puts `class="dark"` on `<html>`, which is what
 * the `.dark` block in `globals.css` keys off. It also injects a tiny inline script to apply that class
 * before first paint, which is the "no flash of the wrong theme on reload" acceptance criterion: without
 * it, somebody who chose dark mode gets a white flash on every navigation and reads that as a bug.
 *
 * `attribute="class"` is the default and is stated anyway, because the `.dark` selector is written against
 * a class and not a `data-theme` attribute, and changing one without the other fails silently.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}