"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * FW-7: Light, Dark, System.
 *
 * ## Why the mounted check
 *
 * `next-themes` cannot know the stored theme during server rendering, so it returns `undefined` for the
 * resolved theme until the client has mounted. Rendering the resolved value before that would put a
 * mismatch between the server's HTML and the client's first render, which React reports and which also
 * flashes.
 *
 * So until mounted this renders a placeholder of the same shape. A control that is briefly inert is
 * invisible; a hydration error is not.
 *
 * ## Why "System" is the default
 *
 * It is the only option that is right for somebody who has never thought about it, and a parish that
 * shares tablets should not have to set each one.
 *
 * ## `variant`
 *
 * `sidebar` for the account menu; `plain` for the sign-in and registration pages, which have no sidebar;
 * `pill` for the landing page's nav, which draws the chip shape the supplied reference uses.
 * One control in three shapes, rather than three controls that drift -- module 01's QA list asks for the
 * switch to work on `/login` as well as inside the shell, and a person who picks dark before signing in
 * should not be flashed white afterwards. A shape is all that changes: the menu, the three options and
 * System are identical everywhere.
 */
export function ThemeSwitch({ variant = "sidebar" }: { variant?: "sidebar" | "plain" | "pill" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = theme ?? "system";
  const isDark = resolvedTheme === "dark";

  const label = !mounted
    ? "Theme"
    : current === "system"
      ? `Theme: System (${isDark ? "dark" : "light"})`
      : `Theme: ${current === "dark" ? "Dark" : "Light"}`;

  const trigger = variant === "sidebar" ? (
    <SidebarMenuButton tooltip="Theme" className="min-h-11">
      {isDark ? <Moon aria-hidden /> : <Sun aria-hidden />}
      <span>{label}</span>
    </SidebarMenuButton>
  ) : variant === "pill" ? (
    // The pill the supplied reference draws: a fully rounded chip on the card colour, with no min-height
    // because it sits in a 64px nav rather than in a form. `pill` is a shape, not a behaviour -- the menu,
    // the three options and System are the same control as everywhere else, and two switches on one
    // screen are free to disagree about which theme is active.
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-[7px] text-[13px] font-medium text-[var(--foreground)]"
      disabled={!mounted}
    >
      {isDark ? <Moon aria-hidden className="size-4" /> : <Sun aria-hidden className="size-4" />}
      <span>{label}</span>
    </button>
  ) : (
    <button
      type="button"
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-3 text-sm"
      disabled={!mounted}
    >
      {isDark ? <Moon aria-hidden className="size-4" /> : <Sun aria-hidden className="size-4" />}
      <span>{label}</span>
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="center" className="w-[min(92vw,16rem)]">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current} onValueChange={setTheme}>
          {OPTIONS.map(({ value, label: optionLabel, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-11">
              <Icon aria-hidden className="size-4" />
              <span>{optionLabel}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
          Follows this device unless you pick one here.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}