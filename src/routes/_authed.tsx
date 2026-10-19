import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user, loading, roles, signOut } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = window.location.pathname + window.location.search;
      navigate({ to: "/login", search: { next } });
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  // Staff gate: if no role yet, show waiting state
  if (roles.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Pending role assignment</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your account exists but hasn't been assigned a role yet. Please ask the Director or an Admin to assign you a role.
          </p>
          <button
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login", search: { next: undefined } }); }}
            className="mt-6 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm"
          >Sign out</button>
        </div>
      </div>
    );
  }
  return <AppShell><IdleSessionGuard onSignOut={signOut} /><Outlet /></AppShell>;
}


/**
 * Signs users out after prolonged inactivity, with a warning before expiry.
 * Supabase remains responsible for its own access/refresh token expiry.
 */
function IdleSessionGuard({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [signingOut, setSigningOut] = useState(false);
  const onSignOutRef = useRef(onSignOut);
  onSignOutRef.current = onSignOut;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningAt = 23 * 60 * 1000;

  useEffect(() => {
    let lastActivity = Date.now();
    const clearTimers = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (logoutTimer.current) clearTimeout(logoutTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
    const endSession = async () => {
      clearTimers();
      setSigningOut(true);
      try {
        await onSignOutRef.current();
      } finally {
        navigate({ to: "/login", search: { next: undefined }, replace: true });
      }
    };
    const schedule = () => {
      clearTimers();
      setWarning(false);
      setSecondsLeft(120);
      lastActivity = Date.now();
      idleTimer.current = setTimeout(() => {
        setWarning(true);
        setSecondsLeft(120);
        const deadline = Date.now() + 120_000;
        countdownTimer.current = setInterval(() => {
          setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        }, 1000);
        logoutTimer.current = setTimeout(() => { void endSession(); }, 120_000);
      }, warningAt);
    };
    const onActivity = () => {
      if (signingOut) return;
      // Avoid resetting timers on every mousemove event.
      if (Date.now() - lastActivity < 1000) return;
      schedule();
    };
    const continueWorking = () => schedule();
    window.addEventListener("njia-session-continue", continueWorking);
    const events: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "click"];
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    schedule();
    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.removeEventListener("njia-session-continue", continueWorking);
      clearTimers();
    };
  }, [navigate, warningAt]);

  if (!warning || signingOut) return null;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-timeout-title"
        aria-describedby="idle-timeout-description"
        className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-xl"
      >
        <h2 id="idle-timeout-title" className="text-lg font-semibold">Are you still there?</h2>
        <p id="idle-timeout-description" className="mt-2 text-sm text-muted-foreground">
          For your security, Njia Smart will sign you out because of inactivity in {minutes}:{String(seconds).padStart(2, "0")}.
          Save any work before your session ends.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => { void (async () => { setSigningOut(true); await onSignOutRef.current(); navigate({ to: "/login", search: { next: undefined }, replace: true }); })(); }}
            className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >Sign out now</button>
          <button
            type="button"
            autoFocus
            onClick={() => { setWarning(false); setSecondsLeft(120); window.dispatchEvent(new Event("njia-session-continue")); }}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >Continue working</button>
        </div>
      </section>
    </div>
  );
}
