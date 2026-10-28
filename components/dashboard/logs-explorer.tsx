"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogLevelBadge } from "@/components/severity";
import { Terminal, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { logs, clients } from "@/app/lib/schema";

type AssetOption = {
  id: string;
  name: string;
  clientName: string | null;
};

export function LogsExplorer({
  logRows,
  clientList,
  assetList,
  page,
  totalPages,
  levelFilter,
  clientFilter,
  assetFilter,
  fromFilter,
  toFilter,
}: {
  logRows: (typeof logs.$inferSelect)[];
  clientList: (typeof clients.$inferSelect)[];
  assetList: AssetOption[];
  page: number;
  totalPages: number;
  levelFilter: string;
  clientFilter: string;
  assetFilter: string;
  fromFilter: string;
  toFilter: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /** Push a new filter set; always resets to page 1 and keeps every other filter. */
  function updateSearch({
    level,
    client,
    asset,
    from,
    to,
  }: {
    level?: string;
    client?: string;
    asset?: string;
    from?: string;
    to?: string;
  }) {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("page", "1");
      if (level) params.set("level", level);
      if (client) params.set("client", client);
      if (asset) params.set("asset", asset);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      router.push(`/dashboard?${params.toString()}`);
    });
  }

  function goPage(newPage: number) {
    startTransition(() => {
      const params = new URLSearchParams();
      params.set("page", String(newPage));
      if (levelFilter) params.set("level", levelFilter);
      if (clientFilter) params.set("client", clientFilter);
      if (assetFilter) params.set("asset", assetFilter);
      if (fromFilter) params.set("from", fromFilter);
      if (toFilter) params.set("to", toFilter);
      router.push(`/dashboard?${params.toString()}`);
    });
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-3.5 text-primary" aria-hidden />
          Logs explorer
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <Search
            className="mb-2 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Level</label>
            <Select
              value={levelFilter || "all"}
              onValueChange={(value) =>
                updateSearch({
                  level: value && value !== "all" ? value : "",
                  client: clientFilter,
                  asset: assetFilter,
                  from: fromFilter,
                  to: toFilter,
                })
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Client</label>
            <Select
              value={clientFilter || "all"}
              onValueChange={(value) =>
                updateSearch({
                  level: levelFilter,
                  client: value && value !== "all" ? value : "",
                  asset: assetFilter,
                  from: fromFilter,
                  to: toFilter,
                })
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {clientList.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Asset</label>
            <Select
              value={assetFilter || "all"}
              onValueChange={(value) =>
                updateSearch({
                  level: levelFilter,
                  client: clientFilter,
                  asset: value && value !== "all" ? value : "",
                  from: fromFilter,
                  to: toFilter,
                })
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assets</SelectItem>
                {assetList.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    {asset.clientName ? `${asset.clientName} — ` : ""}
                    {asset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">From</label>
            <Input
              type="date"
              value={fromFilter}
              onChange={(e) =>
                updateSearch({
                  level: levelFilter,
                  client: clientFilter,
                  asset: assetFilter,
                  from: e.target.value,
                  to: toFilter,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">To</label>
            <Input
              type="date"
              value={toFilter}
              onChange={(e) =>
                updateSearch({
                  level: levelFilter,
                  client: clientFilter,
                  asset: assetFilter,
                  from: fromFilter,
                  to: e.target.value,
                })
              }
            />
          </div>
          {pending && <span className="text-sm text-muted-foreground">Loading…</span>}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No logs.
                </TableCell>
              </TableRow>
            )}
            {logRows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-muted-foreground">
                  {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  <LogLevelBadge level={log.level} />
                </TableCell>
                <TableCell className="text-foreground-secondary">
                  {log.source}
                </TableCell>
                <TableCell>{log.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => goPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}