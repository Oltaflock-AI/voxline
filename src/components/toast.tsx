"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Spec §7.9: "Every asynchronous action produces a toast."
 *
 * Context rather than props because the things that raise toasts (a modal, a
 * stage change, a copy button) are scattered all over the tree, and threading
 * a callback down to each of them would be worse than the problem.
 */
const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

type Toast = { id: number; message: string };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string) => {
    // Date.now() can collide when two toasts fire in the same millisecond,
    // and duplicate React keys make one of them silently vanish.
    const id = Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live so a screen reader announces it; toasts are often the only
          confirmation that anything happened. */}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
