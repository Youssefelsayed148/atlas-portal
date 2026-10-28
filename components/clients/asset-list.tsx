"use client";

import { useActionState } from "react";
import { archiveClientAsset, updateClientAsset } from "@/app/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { clientAssets } from "@/app/lib/schema";

/** Preferred labels for known meta keys; anything else falls back to humanizeKey.
 *  Key order here is also the display order — `meta` is a jsonb column, and Postgres
 *  normalises jsonb object keys by length then bytewise, so the stored order is not
 *  the order the fields were entered in. */
const META_LABELS: Record<string, string> = {
  url: "URL",
  hostingProvider: "Hosting",
  cms: "CMS",
  platform: "Platform",
  version: "Version",
  repoUrl: "Repo",
  triggerKeywords: "Triggers",
  linkedAccount: "Linked account",
  fileName: "File",
  docType: "Type",
  expiryDate: "Expires",
  handle: "Handle",
  followerCount: "Followers",
  connected: "Connected",
};

function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatMetaValue(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  const text = String(value);
  // Render date-ish values (e.g. expiryDate) in the viewer's locale.
  if (/date|expires|expiry/i.test(key)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  }
  return text;
}

const META_ORDER = Object.keys(META_LABELS);

/** "Platform: instagram · Triggers: menu, order · Linked account: @nour" */
function formatMeta(meta: Record<string, unknown> | null) {
  if (!meta) return null;
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .sort(([a], [b]) => {
      const ia = META_ORDER.indexOf(a);
      const ib = META_ORDER.indexOf(b);
      // Known keys first in declared order, then unknown keys alphabetically.
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(
      ([k, v]) =>
        `${META_LABELS[k] ?? humanizeKey(k)}: ${formatMetaValue(k, v)}`
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function AssetList({
  clientId,
  assets,
  manageableAssetTypes,
}: {
  clientId: string;
  assets: (typeof clientAssets.$inferSelect)[];
  manageableAssetTypes: readonly string[];
}) {
  if (assets.length === 0) {
    return <p className="text-sm text-muted-foreground">No assets yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {assets.map((asset) => {
        const metaLine = formatMeta(asset.meta as Record<string, unknown> | null);
        return (
        <li
          key={asset.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-border bg-secondary p-4"
        >
          <div className="min-w-0">
            <p className="font-medium">{asset.name}</p>
            <p className="text-[11.5px] text-muted-foreground">
              {asset.assetType} · {asset.status}
            </p>
            {metaLine && (
              <p className="mt-1 text-[12px] text-foreground-secondary">
                {metaLine}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {manageableAssetTypes.includes(asset.assetType) && (
              <EditAssetDialog asset={asset} />
            )}
            {manageableAssetTypes.includes(asset.assetType) && (
              <ArchiveAssetButton assetId={asset.id} />
            )}
          </div>
        </li>
        );
      })}
    </ul>
  );
}

function ArchiveAssetButton({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState(
    archiveClientAsset.bind(null, assetId),
    { success: false }
  );

  return (
    <form action={action}>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending ? "..." : "Archive"}
      </Button>
      {typeof state.error === "string" && (
        <p className="text-xs text-critical">{state.error}</p>
      )}
    </form>
  );
}

function EditAssetDialog({
  asset,
}: {
  asset: typeof clientAssets.$inferSelect;
}) {
  const [state, action, pending] = useActionState(
    updateClientAsset.bind(null, asset.id),
    { success: false }
  );

  const meta = (asset.meta ?? {}) as Record<string, any>;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Edit
          </Button>
        }
      />
      <DialogContent className="border-border bg-popover text-foreground">
        <DialogHeader>
          <DialogTitle>Edit {asset.assetType}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="clientId" value={asset.clientId} />
          <input type="hidden" name="assetType" value={asset.assetType} />
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={asset.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue={asset.status}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MetaFields assetType={asset.assetType} meta={meta} />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
          {state.success && (
            <p className="text-sm text-ok">Asset updated.</p>
          )}
          {state.error && <p className="text-sm text-critical">{state.error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MetaFields({
  assetType,
  meta,
}: {
  assetType: string;
  meta: Record<string, any>;
}) {
  if (assetType === "website") {
    return (
      <>
        <Field id="url" label="URL" defaultValue={meta.url} type="url" />
        <Field
          id="hostingProvider"
          label="Hosting provider"
          defaultValue={meta.hostingProvider}
        />
        <Field id="cms" label="CMS" defaultValue={meta.cms} />
      </>
    );
  }
  if (assetType === "app") {
    return (
      <>
        <Field id="platform" label="Platform" defaultValue={meta.platform} required />
        <Field id="version" label="Version" defaultValue={meta.version} />
        <Field id="repoUrl" label="Repo URL" defaultValue={meta.repoUrl} type="url" />
      </>
    );
  }
  if (assetType === "chatbot") {
    return (
      <>
        <Field id="platform" label="Platform" defaultValue={meta.platform} required />
        <Field
          id="triggerKeywords"
          label="Trigger keywords"
          defaultValue={meta.triggerKeywords}
        />
        <Field
          id="linkedAccount"
          label="Linked account"
          defaultValue={meta.linkedAccount}
        />
      </>
    );
  }
  if (assetType === "document") {
    return (
      <>
        <Field id="fileName" label="File name" defaultValue={meta.fileName} required />
        <div className="space-y-2">
          <Label htmlFor="docType">Document type</Label>
          <Select name="docType" defaultValue={meta.docType ?? "contract"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contract">Contract</SelectItem>
              <SelectItem value="brand_guide">Brand guide</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Field
          id="expiryDate"
          label="Expiry date"
          defaultValue={meta.expiryDate}
          type="date"
        />
      </>
    );
  }
  if (assetType === "social") {
    return (
      <>
        <Field id="platform" label="Platform" defaultValue={meta.platform} required />
        <Field id="handle" label="Handle" defaultValue={meta.handle} />
        <Field
          id="followerCount"
          label="Follower count"
          defaultValue={meta.followerCount}
          type="number"
        />
        <div className="flex items-center gap-2">
          <input
            id="connected"
            name="connected"
            type="checkbox"
            value="true"
            defaultChecked={meta.connected}
          />
          <Label htmlFor="connected">Connected</Label>
        </div>
      </>
    );
  }
  return null;
}

function Field({
  id,
  label,
  defaultValue,
  type = "text",
  required,
}: {
  id: string;
  label: string;
  defaultValue?: string | number;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
      />
    </div>
  );
}
