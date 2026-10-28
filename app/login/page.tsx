"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.message ?? "Invalid email or password.");
      setPending(false);
      return;
    }

    // Route to a role-appropriate landing page instead of bouncing off
    // /dashboard (which silently redirects non-admins to "/").
    let landing = "/clients";
    try {
      const sessionRes = await fetch("/api/auth/get-session");
      if (sessionRes.ok) {
        const session = (await sessionRes.json()) as {
          user?: { role?: string };
        } | null;
        if (session?.user?.role === "admin") landing = "/dashboard";
      }
    } catch {
      // Fall through to the default landing on any session error.
    }
    router.push(landing);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8 text-foreground">
      <Card className="w-full max-w-sm border-border bg-card">
        <CardHeader>
          <CardTitle>Sign in to Atlas Portal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in..." : "Sign in"}
            </Button>
            {error && <p className="text-sm text-critical">{error}</p>}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
