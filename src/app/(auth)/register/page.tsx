"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    organizationName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }

      // Auto-login after registration, then redirect to setup
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.ok) {
        router.push("/setup");
      } else {
        router.push("/login?registered=true");
      }
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
            theywrk
          </span>
          <span className="text-[#8888A0] opacity-50 text-3xl font-extrabold">.</span>
        </div>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Start building your business operating system</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization Name</Label>
            <Input
              id="orgName"
              placeholder="Your Company Name"
              value={formData.organizationName}
              onChange={(e) => updateField("organizationName", e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={formData.firstName}
                onChange={(e) => updateField("firstName", e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={formData.lastName}
                onChange={(e) => updateField("lastName", e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={formData.email}
              onChange={(e) => updateField("email", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min. 8 characters"
              value={formData.password}
              onChange={(e) => updateField("password", e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating account...
              </span>
            ) : (
              "Create Account"
            )}
          </Button>
          <p className="text-center text-sm text-[#8888A0]">
            Already have an account?{" "}
            <Link href="/login" className="text-purple-400 hover:text-purple-300">
              Sign In
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
