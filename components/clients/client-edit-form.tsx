"use client";

import { useActionState } from "react";
import { updateClient, archiveClient } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { clients } from "@/app/lib/schema";

export function ClientEditForm({
  client,
}: {
  client: typeof clients.$inferSelect;
}) {
  const [state, action, pending] = useActionState(
    updateClient.bind(null, client.id),
    { success: false }
  );

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline">Edit client</Button>} />
      <DialogContent className="border-border bg-popover text-foreground">
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={client.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tier">Tier</Label>
            <Select name="tier" defaultValue={client.tier}>
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
            <Select name="status" defaultValue={client.status}>
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
            <Input id="color" name="color" defaultValue={client.color ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="initials">Initials</Label>
            <Input
              id="initials"
              name="initials"
              defaultValue={client.initials ?? ""}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
          {state.success && (
            <p className="text-sm text-ok">Client updated.</p>
          )}
          {state.error && <p className="text-sm text-critical">{state.error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
