"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<{
    email: string;
    organizationName: string;
    accessLevel: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    organizationName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });

  // If there's a token, fetch invitation details
  useEffect(() => {
    if (token) {
      fetch(`/api/auth/accept-invite?token=${token}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            setError(data.error);
          } else {
            setInvitation(data);
            setFormData((prev) => ({ ...prev, email: data.email }));
          }
        })
        .catch(() => setError("Failed to load invitation"));
    }
  }, [token]);

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const endpoint = token ? "/api/auth/accept-invite" : "/api/auth/register";
      const body = token
        ? { token, firstName: formData.firstName, lastName: formData.lastName, password: formData.password }
        : formData;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }

      // Auto-login after registration
      const { signIn } = await import("next-auth/react");
      const result = await signIn("credentials", {
        email: invitation?.email || formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.ok) {
        router.push(token ? "/dashboard" : "/setup");
      } else {
        router.push("/login?registered=true");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Invitation flow — simpler form
  if (token) {
    return (
      <Card className="border-border bg-surface/80 backdrop-blur">
        <CardHeader className="text-center">
          <div className="mb-4">
            <span
              className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              workwrk
            </span>
            <span className="text-muted opacity-50 text-3xl font-extrabold">.</span>
          </div>
          <CardTitle className="text-xl">Join {invitation?.organizationName || "your team"}</CardTitle>
          <CardDescription>
            {invitation
              ? `You've been invited to join as ${invitation.accessLevel.replace(/_/g, " ")}`
              : "Loading invitation..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            {invitation && (
              <>
                <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3 text-sm text-purple-300">
                  Joining as <strong>{invitation.email}</strong>
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
                      Joining...
                    </span>
                  ) : (
                    "Join Team"
                  )}
                </Button>
              </>
            )}
            <p className="text-center text-sm text-muted">
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

  // Normal registration flow — create new organization
  return (
    <Card className="border-border bg-surface/80 backdrop-blur">
      <CardHeader className="text-center">
        <div className="mb-4">
          <span
            className="bg-gradient-to-r from-purple-500 via-purple-300 to-green-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            workwrk
          </span>
          <span className="text-muted opacity-50 text-3xl font-extrabold">.</span>
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
          <p className="text-center text-sm text-muted">
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

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
