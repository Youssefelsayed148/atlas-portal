import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/app/lib/session";
import { roleCanManageClients } from "@/app/lib/roles";
import { buttonVariants } from "@/components/ui/button";
import { NavLink } from "@/components/nav/nav-link";
import { SignOutButton } from "@/components/nav/sign-out-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    redirect("/login");
  }

  const isAdmin = user.role === "admin";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-6">
          <Link
            href={isAdmin ? "/dashboard" : "/clients"}
            className="font-semibold tracking-tight"
          >
            Atlas Portal
          </Link>

          <nav className="flex items-center gap-1">
            {isAdmin && <NavLink href="/dashboard">Dashboard</NavLink>}
            <NavLink href="/clients">Clients</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {roleCanManageClients(user.role) && (
              <Link
                href="/clients/new"
                className={buttonVariants({ size: "sm" })}
              >
                + New Client
              </Link>
            )}
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
