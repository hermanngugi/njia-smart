import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: LoginPage,
});

type ResetStep = "email" | "code" | "password";

function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) window.location.href = next;
    else navigate({ to: "/dashboard" });
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset flow state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) goNext();
  }, [user, loading]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome back");
      goNext();
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function openReset() {
    setResetStep("email");
    setResetEmail(email);
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setResetOpen(true);
  }

  async function sendResetCode(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail) return;
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail);
      if (error) throw error;
      toast.success("Reset code sent. Check your email (valid for ~15 minutes).");
      setResetStep("code");
    } catch (err: any) {
      toast.error(err.message ?? "Could not send reset code");
    } finally {
      setResetBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!resetCode) return;
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: resetEmail,
        token: resetCode.trim(),
        type: "recovery",
      });
      if (error) throw error;
      toast.success("Code verified. Set your new password.");
      setResetStep("password");
    } catch (err: any) {
      toast.error(err.message ?? "Invalid or expired code");
    } finally {
      setResetBusy(false);
    }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password reset successful. Please sign in.");
      setResetOpen(false);
      setEmail(resetEmail);
      setPassword("");
    } catch (err: any) {
      toast.error(err.message ?? "Could not update password");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-sidebar text-sidebar-foreground p-12">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-white flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="G.K Nahashon & Company logo" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="font-bold">G.K Nahashon</div>
            <div className="text-xs text-sidebar-foreground/60">& Company</div>
          </div>
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-tight">
            Reliable. Credible. Consultants
          </h2>
          <p className="mt-4 text-sidebar-foreground/70">
            Centralize clients, deadlines, audits, tax filings, documents and team communication —
            built for Kenyan firms.
          </p>
        </div>
        <div className="text-xs text-sidebar-foreground/50">© G.K Nahashon & Company</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 text-center">
            <img src="/logo.png" alt="G.K Nahashon & Company logo" className="h-20 w-20 mx-auto mb-3 object-contain" />
            <div className="font-bold text-lg">G.K Nahashon & Company</div>
            <div className="text-xs text-muted-foreground">Office Management Platform</div>
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Access your firm's workspace.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <input
                required type="password" minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
              />
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={openReset}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>
            <button
              disabled={busy} type="submit"
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resetStep === "email" && "Reset your password"}
              {resetStep === "code" && "Enter verification code"}
              {resetStep === "password" && "Set a new password"}
            </DialogTitle>
            <DialogDescription>
              {resetStep === "email" &&
                "Enter your registered office email. We'll send a one-time code (valid ~15 minutes)."}
              {resetStep === "code" &&
                `Enter the code sent to ${resetEmail}.`}
              {resetStep === "password" && "Choose a new password for your account."}
            </DialogDescription>
          </DialogHeader>

          {resetStep === "email" && (
            <form onSubmit={sendResetCode} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Office email</label>
                <input
                  required
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={resetBusy}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
              >
                {resetBusy ? "Sending…" : "Send reset code"}
              </button>
            </form>
          )}

          {resetStep === "code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Verification code</label>
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="6-digit code"
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm tracking-widest"
                />
              </div>
              <button
                type="submit"
                disabled={resetBusy}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
              >
                {resetBusy ? "Verifying…" : "Verify code"}
              </button>
              <button
                type="button"
                onClick={() => setResetStep("email")}
                className="w-full text-xs text-muted-foreground hover:underline"
              >
                Use a different email or resend code
              </button>
            </form>
          )}

          {resetStep === "password" && (
            <form onSubmit={updatePassword} className="space-y-4">
              <div>
                <label className="text-sm font-medium">New password</label>
                <input
                  required
                  type="password"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Confirm new password</label>
                <input
                  required
                  type="password"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-background text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={resetBusy}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
              >
                {resetBusy ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
