"use client";

import { useActionState } from "react";
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
        <input
          className="input"
          type="password"
          id="password"
          name="password"
          placeholder="••••••••••"
          autoComplete="current-password"
          required
        />
      </div>

      <SubmitButton />
    </form>
  );
}
