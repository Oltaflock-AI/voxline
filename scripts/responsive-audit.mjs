/**
 * Responsive audit — walks every route at every width and reports layout
 * failures by measuring, not by looking.
 *
 *   node scripts/responsive-audit.mjs
 *   node scripts/responsive-audit.mjs --widths 390,768
 *
 * Screenshots are a bad tool for this. Sixty of them is a lot to read, a
 * subtle clip is easy to miss, and "looks fine to me" is not a regression
 * test. Three things are checked instead, each of which corresponds to
 * something a person would actually notice:
 *
 *   PAGE OVERFLOW    the document scrolls sideways
 *   OFF-SCREEN       an element's box extends past the viewport's right edge
 *   CLIPPED          an element's content is wider than the element, so text
 *                    is cut off mid-word
 *
 * Exits non-zero when anything is found, so it can gate a commit.
 */
import { chromium } from "playwright";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";
const PASSWORD = "voxline-dev-only";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const WIDTHS = arg("widths", "360,390,480,768,1024,1280,1440")
  .split(",")
  .map((w) => Number(w.trim()));

/** Routes are grouped by who has to be signed in to see them. */
const PORTAL_ROUTES = [
  "/app/blueharbor",
  "/app/blueharbor/calls",
  "/app/blueharbor/calls?band=hot",
  "/app/blueharbor/calls/44444444-0000-0000-0000-000000000002",
  "/app/blueharbor/pipeline",
  "/app/blueharbor/billing",
  "/app/blueharbor/agent",
];
const ADMIN_ROUTES = [
  "/admin",
  "/admin/agencies",
  "/admin/agencies/new",
  "/admin/webhooks",
  "/admin/agencies/11111111-1111-1111-1111-111111111111",
];

/**
 * Elements that are allowed to be wider than they look.
 *
 * A deliberate horizontal scroller (the mobile tab strip) is not a bug, and
 * neither is a `<select>` whose option list exceeds it. Everything else is.
 */
const ALLOWED_CLIPPED = [
  ".mobile-tabs", // deliberate horizontal scroller
  ".admin-nav",   // same
  "select",
  "svg",
  ".sr-only",     // clipped to 1px ON PURPOSE, for screen readers only
];

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function auditPage(page, route, width) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  // Let fonts settle: a layout measured mid-swap reports phantom overflow.
  await page.waitForTimeout(350);

  return page.evaluate(
    ({ width, allowed }) => {
      const problems = [];
      const de = document.documentElement;

      if (de.scrollWidth > de.clientWidth + 1) {
        problems.push({
          type: "PAGE OVERFLOW",
          detail: `document scrolls sideways: ${de.scrollWidth}px in ${de.clientWidth}px`,
        });
      }

      const describe = (el) => {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
            : "";
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };

      const isAllowed = (el) => allowed.some((sel) => el.closest(sel));

      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;

        // Off the right edge of the viewport.
        if (r.right > width + 1 && !isAllowed(el)) {
          problems.push({
            type: "OFF-SCREEN",
            detail: `${describe(el)} right edge at ${Math.round(r.right)}px (viewport ${width}px)`,
          });
        }

        // Content wider than its own box, with no way to reach it.
        //
        // `text-overflow: ellipsis` on a nowrap element is DESIGNED truncation
        // — the reader is told the text continues and the full value is a
        // click away. Only silent clipping is a bug.
        const clipped = el.scrollWidth > el.clientWidth + 1;
        const scrollable = /auto|scroll/.test(cs.overflowX);
        const ellipsised =
          cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap";
        if (
          clipped && !scrollable && !ellipsised && !isAllowed(el) && el.clientWidth > 0
        ) {
          problems.push({
            type: "CLIPPED",
            detail: `${describe(el)} content ${el.scrollWidth}px in ${el.clientWidth}px`,
          });
        }
      }

      // Collapse repeats: one broken row in a list of 25 is one bug, not 25.
      const seen = new Set();
      return problems.filter((p) => {
        const key = `${p.type}|${p.detail.replace(/\d+/g, "#")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    { width, allowed: ALLOWED_CLIPPED }
  );
}

const browser = await chromium.launch();
let total = 0;

for (const [, routes, email] of [
  // Signed out first: /login redirects once a session exists, so auditing it
  // in the portal pass silently measured the dashboard instead.
  ["public", ["/login", "/"], null],
  ["portal", PORTAL_ROUTES, "sofia@voxline.test"],
  ["admin", ADMIN_ROUTES, "admin@voxline.test"],
]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  if (email) await login(page, email);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      const problems = await auditPage(page, route, width);
      if (problems.length) {
        total += problems.length;
        console.log(`\n  ${width}px  ${route}`);
        for (const p of problems) console.log(`    ${p.type.padEnd(14)} ${p.detail}`);
      }
    }
  }
  await context.close();
}

await browser.close();

if (total === 0) {
  console.log(`\n✓ no layout problems across ${WIDTHS.length} widths\n`);
} else {
  console.log(`\n✗ ${total} layout problems\n`);
  process.exit(1);
}
