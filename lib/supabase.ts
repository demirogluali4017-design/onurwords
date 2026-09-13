import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase URL veya Anon Key tanımlı değil. .env.local dosyanızı kontrol edin."
  );
}

/**
 * Client-side (tarayıcı) kullanımı için Supabase istemcisi.
 * "use client" bileşenlerinde ve genel okuma işlemlerinde kullanılır.
 * Row Level Security (RLS) politikalarına tabidir.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey
);

/**
 * Server-side (API Route / Server Action) kullanımı için Supabase istemcisi.
 * service_role anahtarını kullanır, bu yüzden RLS'yi bypass eder.
 * SADECE sunucu tarafında (route.ts, server action içinde) import edilmelidir.
 * İstemci (browser) tarafına asla sızdırılmamalıdır.
 */
export function createServiceRoleClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY tanımlı değil. Bu anahtar sadece sunucu ortam değişkenlerinde bulunmalıdır."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
