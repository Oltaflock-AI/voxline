import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Voxline · AI voice agents for travel agencies",
  description:
    "Your agency's phone line, answered every time. Voxline captures a structured trip brief from every caller and routes it to your consultants.",
};

/**
 * Marketing landing page.
 *
 * Spec §6.8: the full marketing site is Phase 3. Until then, "deploy the
 * prototype's marketing view as the landing page with Client login pointing at
 * the portal". This is that holding page, built from the prototype's own
 * tokens and components so it is not visibly a placeholder.
 *
 * Also spec §6.8: the floating Site / Login / Portal pill in the prototype is
 * a development aid and is stripped from anything a client can reach — its CSS
 * was removed during the stylesheet port.
 */
export default function Home() {
  return (
    <>
      <nav className="nav">
        <div className="nav-in">
          <Logo href="/" />
          <div className="nav-right">
            <Link className="btn sm" href="/login">
              Client login
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="hero-solo">
            <span className="eyebrow">A product of Oltaflock AI LLP</span>
            <h1 className="display" style={{ fontSize: "clamp(38px, 6vw, 72px)" }}>
              Your phone line,{" "}
              <span className="serif-i">answered every time</span>
            </h1>
            <p
              style={{
                fontSize: 17,
                color: "var(--text-2)",
                maxWidth: 560,
                margin: "20px auto 0",
                lineHeight: 1.6,
              }}
            >
              Voxline answers your agency&rsquo;s calls, captures a structured
              trip brief (destination, dates, party size, budget, occasion) and
              puts it in your consultants&rsquo; pipeline before the caller has
              hung up.
            </p>

            <div className="hero-cta" style={{ marginTop: 30 }}>
              <Link className="btn lg" href="/login">
                Client login
              </Link>
              <a className="btn-ghost lg" href="mailto:hello@voxline.io">
                Request a demo
              </a>
            </div>

            <p className="hero-note">
              Never miss an after-hours enquiry again.
            </p>
          </div>
        </section>

        <hr className="wave-rule" />

        <section className="block">
          <div className="container">
            <div className="sec-head">
              <h2>What it does</h2>
              <p>
                The agent qualifies. Your people sell. Everything the caller
                said is waiting in the portal, transcribed and structured.
              </p>
            </div>

            <div className="bento">
              <div className="card card-pad">
                <h3>Answers every call</h3>
                <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
                  Inbound, after hours, and while your team is on other lines.
                  Callers get a real conversation, not a voicemail beep.
                </p>
              </div>
              <div className="card card-pad">
                <h3>Captures the trip brief</h3>
                <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
                  Destination, dates, party size, budget and occasion, all
                  structured rather than left as a wall of transcript.
                </p>
              </div>
              <div className="card card-pad">
                <h3>Fills your pipeline</h3>
                <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
                  Qualifying calls become pipeline cards automatically, linked
                  back to the recording and transcript.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="container foot-bottom">
          <Logo href="/" size="sm" />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            A product of Oltaflock AI LLP
          </span>
        </div>
      </footer>
    </>
  );
}
