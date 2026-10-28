import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/app/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }

  // Authenticated visitors go straight to their role landing page.
  if (user) {
    redirect(user.role === "admin" ? "/dashboard" : "/clients");
  }

  // Public landing for unauthenticated visitors — no DB details exposed.
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 text-foreground">
      <div className="logo-mark flex size-10 items-center justify-center rounded-lg">
        <span className="text-base font-bold text-[#06111F]">A</span>
      </div>
      <h1 className="text-3xl font-bold">Atlas Portal</h1>
      <p className="text-muted-foreground">Internal client management portal</p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Sign in
      </Link>
    </main>
  );
}