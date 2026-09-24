import { createBrowserClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Ortam değişkeni yokken (yerel önizleme) sorgular boş döner.
 * Anahtarlar tanımlıyken gerçek istemci kullanılır.
 */
export function createUnconfiguredClient(): SupabaseClient {
  const settled = Promise.resolve({ data: null, error: null, count: 0, status: 200, statusText: "OK" });
  const chain: unknown = new Proxy(function noop() {
    return chain;
  }, {
    get(_target, prop) {
      if (prop === "then") return settled.then.bind(settled);
      if (prop === "catch") return settled.catch.bind(settled);
      if (prop === "finally") return settled.finally.bind(settled);
      return () => chain;
    },
    apply() {
      return chain;
    },
  });

  const auth = {
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: { message: "Supabase yapılandırılmadı" },
    }),
    signOut: async () => ({ error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };

  return {
    from: () => chain,
    auth,
  } as unknown as SupabaseClient;
}

let browserClient: SupabaseClient | null = null;

function getBrowserClient(): SupabaseClient {
  if (!isSupabaseConfigured) return createUnconfiguredClient();
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl as string, supabaseAnonKey as string);
  }
  return browserClient;
}

/**
 * Tarayıcı istemcisi. Oturum çerezdedir, böylece middleware kullanıcıyı görür.
 * Sunucu bileşenleri bunu değil, createSupabaseServerClient kullanır.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getBrowserClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Server-side (API Route) kullanımı için Supabase istemcisi.
 * service_role anahtarını kullanır, bu yüzden RLS'yi bypass eder.
 * SADECE sunucu tarafında import edilmelidir.
 */
export function createServiceRoleClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase URL veya Anon Key tanımlı değil. .env.local dosyanızı kontrol edin."
    );
  }

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
