import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";
import { smtpConfigFromEnv } from "./smtp.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(createHandler({
  secret: Deno.env.get("YONHAP_SYNC_SECRET"),
  createAdmin: () => createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, clientOptions),
  createUserClient: (jwt) => createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { ...clientOptions, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
  smtp: smtpConfigFromEnv((key) => Deno.env.get(key)),
  appUrl: Deno.env.get("MEDIA_APP_URL") ?? "https://inje-playground.vercel.app",
}));
