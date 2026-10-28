"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createClientAsset } from "@/app/lib/actions";
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

const assetTypeLabels: Record<string, string> = {
  website: "Website",
  app: "App",
  chatbot: "Chatbot",
  document: "Document",
  social: "Social",
};

export function AssetForm({
  clientId,
  allowedAssetTypes,
}: {
  clientId: string;
  allowedAssetTypes: readonly string[];
}) {
  const [assetType, setAssetType] = useState<string>(allowedAssetTypes[0] ?? "");
  const [state, action, pending] = useActionState(createClientAsset, {
    success: false,
  });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="assetType" value={assetType} />
      <div className="space-y-2">
        <Label htmlFor="assetType">Asset type</Label>
        <Select
          name="assetType"
          value={assetType}
          onValueChange={(value) => setAssetType(value ?? "")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedAssetTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {assetTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Asset name</Label>
        <Input id="name" name="name" required />
      </div>
      {assetType === "website" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input id="url" name="url" type="url" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hostingProvider">Hosting provider</Label>
            <Input id="hostingProvider" name="hostingProvider" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cms">CMS</Label>
            <Input id="cms" name="cms" />
          </div>
        </>
      )}
      {assetType === "app" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Input id="platform" name="platform" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="version">Version</Label>
            <Input id="version" name="version" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repoUrl">Repo URL</Label>
            <Input id="repoUrl" name="repoUrl" type="url" />
          </div>
        </>
      )}
      {assetType === "chatbot" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Input id="platform" name="platform" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="triggerKeywords">Trigger keywords</Label>
            <Input id="triggerKeywords" name="triggerKeywords" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkedAccount">Linked account</Label>
            <Input id="linkedAccount" name="linkedAccount" />
          </div>
        </>
      )}
      {assetType === "document" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="fileName">File name</Label>
            <Input id="fileName" name="fileName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="docType">Document type</Label>
            <Select name="docType" defaultValue="contract">
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
          <div className="space-y-2">
            <Label htmlFor="expiryDate">Expiry date</Label>
            <Input id="expiryDate" name="expiryDate" type="date" />
          </div>
        </>
      )}
      {assetType === "social" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Input id="platform" name="platform" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="handle">Handle</Label>
            <Input id="handle" name="handle" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="followerCount">Follower count</Label>
            <Input id="followerCount" name="followerCount" type="number" />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="connected"
              name="connected"
              type="checkbox"
              value="true"
            />
            <Label htmlFor="connected">Connected</Label>
          </div>
        </>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add asset"}
      </Button>
      {state.success && (
        <p className="text-sm text-ok">Asset added.</p>
      )}
      {state.error && <p className="text-sm text-critical">{state.error}</p>}
    </form>
  );
}
