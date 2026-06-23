"use client";

import { Suspense, useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle", message: "" };
const devBypass =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_AUTH_BYPASS === "true";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full button-primary py-2.5 disabled:opacity-60"
    >
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forbidden = searchParams.get("error") === "forbidden";
  const [state, formAction] = useFormState(requestMagicLink, initialState);

  // Dev shortcut: skip straight into the console.
  useEffect(() => {
    if (devBypass) router.replace("/admin");
  }, [router]);

  // If already signed in (and not flagged forbidden), bounce to admin —
  // middleware will re-gate and send non-allowed users back here with
  // ?error=forbidden, which breaks any redirect loop.
  useEffect(() => {
    if (forbidden) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) router.replace("/admin");
    });
  }, [router, forbidden]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 px-4">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin sign-in</h1>
        <p className="text-gray-600 mb-6 text-sm">
          Creative Growth Public Archive console
        </p>

        {forbidden ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded mb-6">
            <p className="text-sm text-amber-900">
              That account isn&rsquo;t authorized for the admin console. Sign in
              with an approved Creative Growth account.
            </p>
            <button
              type="button"
              onClick={async () => {
                await createClient().auth.signOut();
                router.replace("/admin/login");
              }}
              className="mt-3 text-sm font-medium text-amber-900 underline"
            >
              Sign out
            </button>
          </div>
        ) : state.status === "sent" ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded mb-6">
            <p className="text-sm text-green-900">{state.message}</p>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@creativegrowth.org"
                className="w-full border border-gray-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {state.status === "error" && (
              <p className="text-sm text-red-600">{state.message}</p>
            )}
            <SubmitButton />
            <p className="text-xs text-gray-500">
              We&rsquo;ll email a one-time link. No password needed.
            </p>
          </form>
        )}

        <div className="mt-6">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-800">
            ← Back to Gallery
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
