import { headers } from "next/headers";
import { auth } from "./auth";
import type { UserRole } from "./roles";

export async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session.user as {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

export async function requireAuth() {
  return getCurrentUser();
}
