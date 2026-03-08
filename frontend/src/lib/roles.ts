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

/** Pages accessible by each role */
const ROLE_ACCESS: Record<UserRole, string[]> = {
  guest: ["/food", "/ladder", "/team"],
  user: ["/food", "/ladder", "/team", "/guide"],
  admin: ["/food", "/ladder", "/team", "/guide", "/admin"],
};

export function canAccess(role: UserRole, pathname: string): boolean {
  const allowed = ROLE_ACCESS[role] ?? ROLE_ACCESS.guest;
  if (pathname === "/") return true;
  return allowed.some((p) => pathname.startsWith(p));
}

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}
