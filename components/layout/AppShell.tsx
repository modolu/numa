"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ReactNode } from "react";

const PRIMARY_NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/tasks", label: "Tasks" },
  { href: "/brief", label: "Brief" },
] as const;

const SECONDARY_NAV = [
  { href: "/wallets", label: "Wallets" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Fluid shell: full width with gutters that scale with the viewport
 * (16px → 24px → 32px → 40px). Readable widths are applied to prose inside
 * pages, never to the shell, so lists and cards grow with the screen.
 */
const SHELL_GUTTERS = "px-4 sm:px-6 lg:px-8 xl:px-10";

function isActive(pathname: string, href: string): boolean {
  if (href === "/inbox") return pathname === "/" || pathname.startsWith("/inbox") || pathname.startsWith("/event");
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const unread = useQuery(api.events.getUnreadCount);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
        <div className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 sm:h-14 sm:flex-nowrap sm:py-0 ${SHELL_GUTTERS}`}>
          <Link
            href="/"
            className="shrink-0 text-[15px] font-semibold tracking-tight text-ink"
            aria-label="Numa home"
          >
            Numa
          </Link>
          <nav aria-label="Primary" className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
            {PRIMARY_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]"
                      : "text-ink-secondary hover:bg-surface-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  {item.href === "/inbox" && unread !== undefined && unread > 0 && (
                    <span
                      className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-medium leading-5 text-white"
                      aria-label={`${unread} unread`}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <nav aria-label="Secondary" className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            {SECONDARY_NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-2 py-1.5 text-[13px] transition-colors sm:px-2.5 ${
                    active ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className={`w-full flex-1 pb-24 pt-8 sm:pt-10 ${SHELL_GUTTERS}`}>
        {children}
      </main>
      <footer className="border-t border-line">
        <div className={`flex w-full items-center justify-between gap-4 py-4 text-[12px] text-ink-muted ${SHELL_GUTTERS}`}>
          <span>Read-only monitoring. Numa never holds funds or signs transactions.</span>
          <span className="font-mono">ADVISORY</span>
        </div>
      </footer>
    </div>
  );
}
