"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Something went wrong");
      }

      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-[#2A2A3A] bg-[#12121A]/80 backdrop-blur">
      <CardHeader className="text-center">
        <div className="mb-4">
          <span
            className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            workwrk
          </span>
          <span className="text-[#8888A0] opacity-50 text-3xl font-extrabold">.</span>
        </div>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          {sent
            ? "Check your email for a reset link"
            : "Enter your email and we'll send you a reset link"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 text-sm text-green-400">
              If an account with that email exists, we've sent a password reset link. Check your inbox (and spam folder).
            </div>
            <p className="text-center text-sm text-[#8888A0]">
              <Link href="/login" className="text-purple-400 hover:text-purple-300">
                Back to Sign In
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </span>
              ) : (
                "Send Reset Link"
              )}
            </Button>
            <p className="text-center text-sm text-[#8888A0]">
              Remember your password?{" "}
              <Link href="/login" className="text-purple-400 hover:text-purple-300">
                Sign In
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
