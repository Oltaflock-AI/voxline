"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  /** null = the index route, /app/[tenant] */
  segment: string | null;
  label: string;
  short: string;
  icon: ReactNode;
  count?: number;
};

const icon = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  calls: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="10" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </svg>
  ),
  billing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </svg>
  ),
  agent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H2a2 2 0 110-4h.1A1.7 1.7 0 003.6 8a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H8a1.7 1.7 0 001-1.5V2a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V8a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  ),
};

export function navItems(callCount: number, leadCount: number): NavItem[] {
  return [
    { segment: null, label: "Overview", short: "Overview", icon: icon.overview },
    { segment: "calls", label: "Calls", short: "Calls", icon: icon.calls, count: callCount },
    { segment: "pipeline", label: "Trip Pipeline", short: "Pipeline", icon: icon.pipeline, count: leadCount },
    { segment: "billing", label: "Billing & Usage", short: "Billing", icon: icon.billing },
    { segment: "agent", label: "Agent Setup", short: "Agent", icon: icon.agent },
  ];
}

/**
 * useSelectedLayoutSegment() returns the active child segment of the layout
 * this renders in — "calls", "pipeline", or null for the index route. That is
 * why this is a Client Component: it needs to know where the user currently
 * is. Everything around it in the layout stays on the server.
 */
export function SidebarNav({
  tenantSlug,
  callCount,
  leadCount,
}: {
  tenantSlug: string;
  callCount: number;
  leadCount: number;
}) {
  const active = useSelectedLayoutSegment();
  const items = navItems(callCount, leadCount);
  const href = (s: string | null) => `/app/${tenantSlug}${s ? `/${s}` : ""}`;

  return (
    <nav className="side-nav">
      <span className="lab">Workspace</span>
      {items.slice(0, 3).map((it) => (
        <Link
          key={it.label}
          className={`nav-item${active === it.segment ? " on" : ""}`}
          href={href(it.segment)}
        >
          {it.icon} {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </Link>
      ))}
      <span className="lab">Account</span>
      {items.slice(3).map((it) => (
        <Link
          key={it.label}
          className={`nav-item${active === it.segment ? " on" : ""}`}
          href={href(it.segment)}
        >
          {it.icon} {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Spec §7.9: the sidebar collapses to a horizontal tab strip under 1000px. */
export function MobileTabs({
  tenantSlug,
  callCount,
  leadCount,
}: {
  tenantSlug: string;
  callCount: number;
  leadCount: number;
}) {
  const active = useSelectedLayoutSegment();
  const items = navItems(callCount, leadCount);
  return (
    <div className="mobile-tabs">
      {items.map((it) => (
        <Link
          key={it.label}
          className={active === it.segment ? "on" : ""}
          href={`/app/${tenantSlug}${it.segment ? `/${it.segment}` : ""}`}
        >
          {it.short}
        </Link>
      ))}
    </div>
  );
}

/** The tab name shown in the topbar breadcrumb. */
export function TopbarTab() {
  const active = useSelectedLayoutSegment();
  const titles: Record<string, string> = {
    calls: "Calls",
    pipeline: "Trip Pipeline",
    billing: "Billing & Usage",
    agent: "Agent Setup",
  };
  return <span className="sub">{active ? titles[active] ?? "" : "Overview"}</span>;
}
