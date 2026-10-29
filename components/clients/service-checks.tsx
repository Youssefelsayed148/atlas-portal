"use client";

import { useActionState, useState } from "react";
import {
  createServiceCheck,
  deleteServiceCheck,
  toggleServiceCheck,
  updateServiceCheck,
} from "@/app/lib/service-check-actions";
import type { ServiceCheckView } from "@/app/lib/service-check-view";
import { SeverityTag, type Severity } from "@/components/severity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type CheckableAsset = {
  id: string;
  name: string;
  assetType: string;
  /** meta.url of a website asset, used to prefill the target. */
  url?: string;
};

type CheckType = ServiceCheckView["checkType"];

const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  http: "HTTP (page is reachable)",
  api: "API (JSON endpoint)",
  db: "Database (Postgres)",
  webhook: "Webhook (delivery staleness)",
};

const STATUS_TO_SEVERITY: Record<string, Severity> = {
  up: "ok",
  degraded: "warning",
  down: "critical",
};

function formatInterval(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function str(value: unknown) {
  return value == null ? "" : String(value);
}

function formatExpectedValue(value: unknown) {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return JSON.stringify(value); // keep "123" a string when re-submitted
    } catch {
      return value;
    }
  }
  return value === undefined ? "" : JSON.stringify(value);
}

function formatHeaders(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

export function ServiceChecksPanel({
  checks,
  assets,
  canManage,
}: {
  checks: ServiceCheckView[];
  assets: CheckableAsset[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          {assets.length > 0 ? (
            <CheckDialog mode="create" assets={assets} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Add a website, app or chatbot asset first to attach checks to it.
            </p>
          )}
        </div>
      )}
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No service checks yet. The prober only watches what is listed here.
        </p>
      ) : (
        <ul className="space-y-3">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckRow({
  check,
  canManage,
}: {
  check: ServiceCheckView;
  canManage: boolean;
}) {
  const latest = check.latest;
  const severity = latest ? STATUS_TO_SEVERITY[latest.status] : undefined;

  return (
    <li className="rounded-lg border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{check.name}</p>
            <Badge variant="outline">{check.checkType}</Badge>
            {!check.isActive && <Badge variant="secondary">Paused</Badge>}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {check.assetName} · every {formatInterval(check.intervalSeconds)}
          </p>
          <p className="break-all text-[12px] text-foreground-secondary">
            {check.displayTarget}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <CheckDialog mode="edit" check={check} />
            <ToggleButton check={check} />
            <DeleteButton check={check} />
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-border pt-3 text-[12px]">
        {latest && severity ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SeverityTag severity={severity} />
              <span className="text-muted-foreground">{latest.status}</span>
              {latest.latencyMs != null && (
                <span className="text-muted-foreground">{latest.latencyMs} ms</span>
              )}
              {latest.statusCode != null && (
                <span className="text-muted-foreground">HTTP {latest.statusCode}</span>
              )}
              <time
                dateTime={latest.checkedAt}
                suppressHydrationWarning
                className="text-muted-foreground"
              >
                {new Date(latest.checkedAt).toLocaleString()}
              </time>
            </div>
            {latest.errorMessage && (
              <p className="text-foreground-secondary">{latest.errorMessage}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {check.isActive
              ? "No result yet. The prober picks new checks up within a minute."
              : "Paused. The prober skips this check."}
          </p>
        )}
      </div>
    </li>
  );
}

function ToggleButton({ check }: { check: ServiceCheckView }) {
  const [state, action, pending] = useActionState(
    toggleServiceCheck.bind(null, check.id),
    { success: false } as { success: boolean; error?: string }
  );
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "..." : check.isActive ? "Pause" : "Resume"}
      </Button>
      {state.error && <p className="text-xs text-critical">{state.error}</p>}
    </form>
  );
}

function DeleteButton({ check }: { check: ServiceCheckView }) {
  const [state, action, pending] = useActionState(
    deleteServiceCheck.bind(null, check.id),
    { success: false } as { success: boolean; error?: string }
  );
  return (
    <form action={action}>
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={(event) => {
          if (
            !window.confirm(
              `Delete "${check.name}"? Its history and any alerts raised by it are deleted too.`
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        {pending ? "..." : "Delete"}
      </Button>
      {state.error && <p className="text-xs text-critical">{state.error}</p>}
    </form>
  );
}

type DialogProps =
  | { mode: "create"; assets: CheckableAsset[]; check?: undefined }
  | { mode: "edit"; check: ServiceCheckView; assets?: undefined };

function CheckDialog(props: DialogProps) {
  const [open, setOpen] = useState(false);
  const isEdit = props.mode === "edit";
  const check = props.check;

  const [assetId, setAssetId] = useState(props.assets?.[0]?.id ?? "");
  const [checkType, setCheckType] = useState<CheckType>(check?.checkType ?? "http");
  const [target, setTarget] = useState(check?.target ?? "");
  const [targetTouched, setTargetTouched] = useState(isEdit);

  const submit = isEdit ? updateServiceCheck.bind(null, check!.id) : createServiceCheck;
  const [state, action, pending] = useActionState(
    async (_prev: { success: boolean; error?: string }, formData: FormData) => {
      const result = await submit(null, formData);
      if (result.success) {
        setOpen(false);
        if (!isEdit) {
          setTarget("");
          setTargetTouched(false);
        }
      }
      return result;
    },
    { success: false } as { success: boolean; error?: string }
  );

  function websiteUrlFor(id: string) {
    return props.assets?.find((a) => a.id === id)?.url ?? "";
  }

  // Create flow: prefill the target from the website asset's saved URL until
  // the user types their own.
  function prefill(nextAssetId: string, nextType: CheckType) {
    if (isEdit || targetTouched) return;
    setTarget(nextType === "http" || nextType === "api" ? websiteUrlFor(nextAssetId) : "");
  }

  const config = check?.config ?? {};
  const expectedStatus = Array.isArray(config.expectedStatus)
    ? (config.expectedStatus as unknown[])
    : [];

  const targetLabel =
    checkType === "db"
      ? "Connection string"
      : checkType === "webhook"
        ? "Label (no outbound request is made)"
        : "URL";
  const targetPlaceholder =
    checkType === "db"
      ? "postgres://readonly_user:password@host:5432/dbname"
      : checkType === "webhook"
        ? "e.g. Order confirmation webhook"
        : "https://example.com/health";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "outline" : "default"} size="sm">
            {isEdit ? "Edit" : "Add service check"}
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${check!.name}` : "Add service check"}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label>Asset</Label>
              <input type="hidden" name="assetId" value={assetId} />
              <Select
                value={assetId}
                onValueChange={(value) => {
                  const next = value ?? "";
                  setAssetId(next);
                  prefill(next, checkType);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.assets!.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      {asset.name} ({asset.assetType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Check type</Label>
            <input type="hidden" name="checkType" value={checkType} />
            <Select
              value={checkType}
              onValueChange={(value) => {
                const next = (value ?? "http") as CheckType;
                setCheckType(next);
                prefill(assetId, next);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CHECK_TYPE_LABELS) as CheckType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {CHECK_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-name">Name</Label>
            <Input
              id="sc-name"
              name="name"
              required
              defaultValue={check?.name ?? ""}
              placeholder="e.g. Website up"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-target">{targetLabel}</Label>
            <Input
              id="sc-target"
              name="target"
              required
              value={target}
              placeholder={targetPlaceholder}
              onChange={(event) => {
                setTarget(event.target.value);
                setTargetTouched(true);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-interval">Check every (seconds, minimum 60)</Label>
            <Input
              id="sc-interval"
              name="intervalSeconds"
              type="number"
              min={60}
              required
              defaultValue={check?.intervalSeconds ?? 300}
            />
          </div>

          {(checkType === "http" || checkType === "api") && (
            <>
              <NumberField
                id="sc-latency"
                name="latencyWarningMs"
                label="Warn if slower than (ms, optional)"
                defaultValue={str(config.latencyWarningMs)}
              />
              <NumberField
                id="sc-timeout"
                name="timeoutMs"
                label="Timeout (ms, optional, default 15000)"
                defaultValue={str(config.timeoutMs)}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  id="sc-status-min"
                  name="expectedStatusMin"
                  label="Expected status from"
                  defaultValue={str(expectedStatus[0])}
                  placeholder="200"
                />
                <NumberField
                  id="sc-status-max"
                  name="expectedStatusMax"
                  label="Expected status to"
                  defaultValue={str(expectedStatus[1])}
                  placeholder="299"
                />
              </div>
              <TextField
                id="sc-body"
                name="bodyContains"
                label="Response must contain (optional)"
                defaultValue={str(config.bodyContains)}
              />
              <MethodField defaultValue={str(config.method) || "GET"} />
            </>
          )}

          {checkType === "api" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="sc-headers">Request headers (one per line, optional)</Label>
                <Textarea
                  id="sc-headers"
                  name="headers"
                  rows={3}
                  placeholder={"Authorization: Bearer <token>"}
                  defaultValue={formatHeaders(config.headers)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  id="sc-field"
                  name="expectedField"
                  label="JSON field to check"
                  defaultValue={str(config.expectedField)}
                  placeholder="status"
                />
                <TextField
                  id="sc-value"
                  name="expectedValue"
                  label="Must equal"
                  defaultValue={formatExpectedValue(config.expectedValue)}
                  placeholder="ok"
                />
              </div>
            </>
          )}

          {checkType === "db" && (
            <>
              <TextField
                id="sc-query"
                name="healthQuery"
                label="Health query (SELECT only, default SELECT 1)"
                defaultValue={str(config.healthQuery)}
              />
              <NumberField
                id="sc-db-latency"
                name="latencyWarningMs"
                label="Warn if slower than (ms, optional)"
                defaultValue={str(config.latencyWarningMs)}
              />
              <NumberField
                id="sc-db-timeout"
                name="timeoutMs"
                label="Timeout (ms, optional, default 10000)"
                defaultValue={str(config.timeoutMs)}
              />
              <p className="text-xs text-muted-foreground">
                The connection string is stored as plain text. Use a read-only database
                user.
              </p>
            </>
          )}

          {checkType === "webhook" && (
            <>
              <NumberField
                id="sc-stale"
                name="staleAfterMinutes"
                label="Down if no delivery for (minutes, default 60)"
                defaultValue={str(config.staleAfterMinutes)}
              />
              <p className="text-xs text-muted-foreground">
                The service that receives the webhook must write its own results into the
                portal. Until that is built this check stays down.
              </p>
            </>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : isEdit ? "Save changes" : "Add check"}
          </Button>
          {state.error && <p className="text-sm text-critical">{state.error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MethodField({ defaultValue }: { defaultValue: string }) {
  const [method, setMethod] = useState(defaultValue);
  return (
    <div className="space-y-2">
      <Label>Method</Label>
      <input type="hidden" name="method" value={method} />
      <Select value={method} onValueChange={(value) => setMethod(value ?? "GET")}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GET">GET</SelectItem>
          <SelectItem value="HEAD">HEAD</SelectItem>
          <SelectItem value="POST">POST</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

function NumberField({
  id,
  name,
  label,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="number"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </div>
  );
}
