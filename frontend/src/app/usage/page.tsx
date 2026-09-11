import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import { canUsePage, PAGES } from "@/lib/page-access";

export default async function UsageIndexPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [profile, access] = await Promise.all([
    supabase.from("user_profiles").select("role").eq("user_id", user.id).single(),
    supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profile.error || access.error) redirect("/access-denied");
  const page = PAGES.find((p) => p.group === "ai" && canUsePage(profile.data.role, p.key, access.data?.permissions ?? {}));
  redirect(page?.href ?? "/access-denied");
}
