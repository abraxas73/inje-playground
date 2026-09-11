import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  secret: Deno.env.get("YONHAP_SYNC_SECRET"),
  createAdmin: () => createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ),
}));
