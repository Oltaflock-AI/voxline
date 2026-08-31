import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Voxline" };

/**
 * SERVER COMPONENT. Renders once on the server and ships zero JavaScript for
 * itself — only <LoginForm/>, which is marked "use client", reaches the
 * browser. That split is concept #1, and it is visible right here: the quote
 * and metrics below are plain HTML in the response.
 *
 * searchParams is a Promise in Next.js 16. Awaiting it is required, not
 * stylistic — the synchronous form was removed, not deprecated.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  const nextPath = typeof next === "string" ? next : "/app";

  return (
    <div className="auth">
      <aside className="auth-aside">
        <Logo />

        <div className="auth-quote">
          <p>
            &ldquo;We stopped losing the after-hours calls. Last month the agent
            captured <span className="serif-i">thirty-one</span> trip briefs
            while the office was dark.&rdquo;
          </p>
          <cite>Sofia Marchetti · Director, Blue Harbor Travel</cite>
        </div>

        {/*
          Metrics and waveform are siblings in one flex row, not a content block
          with a decoration absolutely positioned on top of it. The prototype
          anchors the waveform bottom-right with `.wm`, which puts it in the same
          band as these numbers — below roughly 1400px they overlap, and the
          aside is only ever about half the viewport, so in practice they always
          did. Sharing a row means they cannot collide at any width.
        */}
        <div className="auth-aside-foot">
          <div className="auth-metrics">
            <div>
              <b className="num">1,240</b>
              <span>calls answered this month</span>
            </div>
            <div>
              <b className="num">98.6%</b>
              <span>pick-up rate</span>
            </div>
            <div>
              <b className="num">&lt;60s</b>
              <span>brief in your pipeline</span>
            </div>
          </div>

          <span className="auth-wave" aria-hidden="true">
            <svg
              viewBox="0 0 240 60"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            >
              {[
                [6, 24, 12], [18, 16, 28], [30, 6, 48], [42, 21, 18],
                [54, 3, 54], [66, 25, 10], [78, 13, 34], [90, 19, 22],
                [102, 4, 52], [114, 23, 14], [126, 10, 40], [138, 17, 26],
                [150, 2, 56], [162, 22, 16], [174, 12, 36], [186, 20, 20],
                [198, 6, 48], [210, 24, 12], [222, 15, 30], [234, 21, 18],
              ].map(([x, y, h]) => (
                <path key={x} d={`M${x} ${y} v${h}`} />
              ))}
            </svg>
          </span>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <Logo />
          <h2>Welcome back</h2>
          <div className="sub">Sign in to your agency portal.</div>

          <LoginForm next={nextPath} />

          <div className="auth-foot">
            Trouble signing in?{" "}
            <a
              href="mailto:support@voxline.io"
              style={{ color: "var(--accent-text)", fontWeight: 600 }}
            >
              Email support
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
