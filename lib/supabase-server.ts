import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createUnconfiguredClient, isSupabaseConfigured } from "@/lib/supabase";

export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!isSupabaseConfigured || !url || !key) {
    return createUnconfiguredClient();
  }

  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component içinden çerez yazılamaz; middleware yeniler.
        }
      },
    },
  });
}
