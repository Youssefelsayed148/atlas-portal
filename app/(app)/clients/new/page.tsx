"use client";

import { useActionState } from "react";
import { createClient } from "@/app/lib/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

export default function NewClientPage() {
  const [state, action, pending] = useActionState(createClient, {
    success: false,
  });

  return (
    <main className="flex-1 p-8 text-foreground">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-4">
          <Link className={buttonVariants({ variant: "outline" })} href="/clients">
            Back
          </Link>
          <h1 className="text-2xl font-bold">New client</h1>
        </div>
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Client details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={action} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tier">Tier</Label>
                <Select name="tier" defaultValue="starter">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select name="status" defaultValue="onboarding">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="at_risk">At risk</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="offboarded">Offboarded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="color">Color</Label>
                <Input id="color" name="color" placeholder="#0f172a" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="initials">Initials</Label>
                <Input id="initials" name="initials" placeholder="AB" />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create client"}
              </Button>
              {state.success && (
                <p className="text-sm text-ok">Client created.</p>
              )}
              {state.error && (
                <p className="text-sm text-critical">{state.error}</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
