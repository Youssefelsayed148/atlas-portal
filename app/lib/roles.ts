import { userRoleEnum } from "./schema";

export type UserRole = (typeof userRoleEnum.enumValues)[number];

const sectionVisibility: Record<
  UserRole,
  Record<"website" | "apps" | "chatbot" | "documents" | "social" | "health", boolean>
> = {
  admin: {
    website: true,
    apps: true,
    chatbot: true,
    documents: true,
    social: true,
    health: true,
  },
  developer: {
    website: true,
    apps: true,
    chatbot: true,
    documents: false,
    social: false,
    health: true,
  },
  legal: {
    website: false,
    apps: false,
    chatbot: false,
    documents: true,
    social: false,
    health: false,
  },
  social_media_manager: {
    website: false,
    apps: false,
    chatbot: true,
    documents: false,
    social: true,
    health: false,
  },
  content_creator: {
    website: false,
    apps: false,
    chatbot: false,
    documents: true,
    social: true,
    health: false,
  },
};

export function roleCanViewSection(
  role: UserRole,
  section: keyof (typeof sectionVisibility)["admin"]
) {
  return sectionVisibility[role]?.[section] ?? false;
}

const assetTypePermissions: Record<UserRole, ("website" | "app" | "chatbot" | "document" | "social")[]> = {
  admin: ["website", "app", "chatbot", "document", "social"],
  developer: ["website", "app", "chatbot"],
  legal: ["document"],
  social_media_manager: ["chatbot", "social"],
  content_creator: ["document", "social"],
};

export function roleCanManageAssetType(
  role: UserRole,
  assetType: "website" | "app" | "chatbot" | "document" | "social"
) {
  return assetTypePermissions[role]?.includes(assetType) ?? false;
}

export function roleCanManageClients(role: UserRole) {
  return role === "admin" || role === "developer";
}
