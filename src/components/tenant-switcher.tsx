"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { TenantSummary } from "@/lib/tenant";

/**
 * The tenant switcher. Spec §6.1: lists tenants from `memberships`, and
 * "Add agency account" is admin-only and hidden for clients in v1.
 *
 * The current tenant lives in the URL (`/app/[tenant]/…`), not in React state
 * or a cookie. That means a switch is a navigation, every portal URL is
 * shareable and bookmarkable, and there is no "which tenant am I in?" state to
 * get out of sync with what is on screen.
 */
export function TenantSwitcher({
  tenants,
  current,
}: {
  tenants: TenantSummary[];
  current: TenantSummary;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false); // spec §7.9: Escape closes any overlay
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function switchTo(slug: string) {
    setOpen(false);
    // Keep the current tab when switching agency: /app/a/calls -> /app/b/calls
    const rest = pathname.split("/").slice(3).join("/");
    router.push(`/app/${slug}${rest ? `/${rest}` : ""}`);
  }

  /**
   * Most agencies belong to exactly one tenant, so this is the common case in
   * production, not an edge case. A chevron on a menu with a single entry
   * promises a choice that does not exist — it reads as "there are other
   * agencies here" and invites a click that does nothing. With one tenant this
   * renders as a plain identity block instead of a control.
   */
  const canSwitch = tenants.length > 1;

  const identity = (
    <>
      <span className="t-logo">{current.initials}</span>
      <span className="meta">
        <span className="name">{current.name}</span>
        <span className="plan">{current.planName?.toUpperCase() ?? "NO PLAN"}</span>
      </span>
    </>
  );

  if (!canSwitch) {
    return (
      <div className="switcher">
        <div className="switcher-btn switcher-static">{identity}</div>
      </div>
    );
  }

  return (
    <div className="switcher" ref={ref}>
      <button
        className="switcher-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {identity}
        <svg
          className="caret"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="switcher-menu open" role="menu">
          {tenants.map((t) => (
            <button
              key={t.id}
              className="switcher-item"
              role="menuitem"
              onClick={() => switchTo(t.slug)}
            >
              <span className="t-logo">{t.initials}</span>
              <span className="meta">
                <span className="name">{t.name}</span>
                <span className="plan">{t.planName?.toUpperCase() ?? "NO PLAN"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
