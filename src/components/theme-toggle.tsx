"use client";

/**
 * Spec §6.9: dark and light, defaulting to system preference, persisted per
 * user. localStorage now; `profiles.theme_pref` is the durable store and gets
 * wired when we have a place to save it from.
 *
 * The actual first paint is set by the inline script in the root layout —
 * doing it here would mean a flash of the wrong theme on every load.
 */
export function ThemeToggle() {
  function toggle() {
    const el = document.documentElement;
    const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
    el.setAttribute("data-theme", next);
    try {
      localStorage.setItem("vx-theme", next);
    } catch {
      // Safari private mode throws on localStorage. A theme preference is not
      // worth breaking the page over.
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
      <svg
        className="i-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg
        className="i-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    </button>
  );
}
