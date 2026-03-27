"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0A0F]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <span className="text-sm text-[#8888A0]">Loading...</span>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-purple-600/5 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 h-80 w-80 rounded-full bg-green-500/5 blur-3xl" />
      </div>

      {/* Header */}
      <div className="relative border-b border-[#2A2A3A] bg-[#0A0A0F]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-6">
          <span
            className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-xl font-extrabold tracking-tight text-transparent"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            theywrk
          </span>
          <span className="text-[#8888A0] opacity-50 text-xl font-extrabold">.</span>
          <span className="ml-4 text-sm text-[#8888A0]">Setup your workspace</span>
        </div>
      </div>

      {/* Content */}
      <div className="relative mx-auto max-w-4xl px-6 py-10">
        {children}
      </div>
    </div>
  );
}
