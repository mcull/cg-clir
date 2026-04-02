"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Check if already authenticated
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        router.push("/admin");
      }
    };

    checkAuth();
  }, [router, supabase]);

  // If auth bypass is enabled, redirect to admin
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTH_BYPASS === "true") {
      router.push("/admin");
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Login</h1>

        <p className="text-gray-600 mb-6">
          This admin console requires authentication. Please configure your
          Supabase authentication settings to use this feature.
        </p>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            For local development with{" "}
            <code className="bg-blue-100 px-2 py-1 rounded">
              NEXT_PUBLIC_AUTH_BYPASS=true
            </code>
            , you will be automatically logged in.
          </p>
        </div>

        <div className="mt-6">
          <a
            href="/"
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Gallery
          </a>
        </div>
      </div>
    </div>
  );
}
