"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

/**
 * CLIENT COMPONENT — the "use client" at the top is the whole difference.
 * This one needs interactivity (pending state, an error message that appears
 * without a full page load), so it ships to the browser. The page that renders
 * it stays on the server.
 */

function SubmitButton() {
  // useFormStatus reads the pending state of the nearest parent <form>.
  // It only works in a component *inside* that form, which is why this is
  // split out rather than inlined above.
  const { pending } = useFormStatus();
  return (
    <button
      className="btn"
      type="submit"
      disabled={pending}
      style={{ width: "100%", marginTop: 6 }}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {
    error: null,
  });
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <div className="auth-err" style={{ display: "block" }} role="alert">
          {state.error}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          className="input"
          type="email"
          id="email"
          name="email"
          placeholder="you@youragency.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        {/*
          Show/hide, because a password typed wrong on a phone keyboard is the
          commonest reason a correct password "does not work", and the only way
          to check is to retype it blind.

          The button is type="button": inside a form, a button with no type
          defaults to submit, so tapping the eye would try to sign in with a
          half-typed password.
        */}
        <div className="input-with-action">
          <input
            className="input"
            type={showPassword ? "text" : "password"}
            id="password"
            name="password"
            placeholder="••••••••••"
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="input-action"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c5.5 0 9 6 9 6a15 15 0 0 1-2.4 3.1M6.6 6.6A15 15 0 0 0 3 12s3.5 6 9 6a9.6 9.6 0 0 0 4-.9" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
