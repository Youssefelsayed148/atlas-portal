import { db } from "@/app/lib/db";
import { clients } from "@/app/lib/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const allClients = await db
    .select()
    .from(clients)
    .orderBy(desc(clients.createdAt));

  return (
    <main className="flex-1 p-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Clients</h1>
          <Link className={buttonVariants()} href="/clients/new">New client</Link>
        </div>
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>All clients</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Initials</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No clients yet.
                    </TableCell>
                  </TableRow>
                )}
                {allClients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{client.tier}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge>{client.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.initials ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                        href={`/clients/${client.id}`}
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
