"use client";

import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-3xl text-fg">Astrobiz</h1>
          <p className="mt-1 text-muted">Operations dashboard</p>
        </div>

        <div className="rounded-panel border border-line bg-panel p-6 shadow-card">
          {error && (
            <div className="mb-4 rounded-control border border-bad/50 bg-bad-soft px-3 py-2 text-sm text-fg">
              Sign-in failed. Try again, and make sure you use your work Google account.
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-control bg-accent px-4 py-3 font-display text-sm text-accent-ink transition-colors hover:bg-accent-hover"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>

          <p className="mt-4 text-center text-xs text-muted">
            Only Astrobiz staff accounts can sign in.
          </p>
        </div>

        <div className="mt-6 flex justify-center gap-4 text-xs text-dim">
          <a href="/privacy-policy" className="hover:text-fg">Privacy policy</a>
          <a href="/terms-of-service" className="hover:text-fg">Terms of service</a>
          <a href="/data-deletion" className="hover:text-fg">Data deletion</a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas">
          <div className="text-muted">Loading…</div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
