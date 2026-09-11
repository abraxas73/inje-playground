import { canOpenPage, type PagePermissions } from "./page-access";
export type UserRole = "guest" | "user" | "admin";

export interface UserRoleInfo {
  id: string;
  user_id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function canAccess(role: UserRole, pathname: string, permissions: PagePermissions = {}): boolean {
  return canOpenPage(role, pathname, permissions);
}

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}
