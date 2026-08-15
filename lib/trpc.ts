import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          const h: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

          /**
           * Supabase access token in its OWN header.
           *
           * Authorization stays reserved for the Manus session token that
           * existing protectedProcedure/adminProcedure paths rely on, so this is
           * purely additive. The server verifies this token against Supabase
           * before trusting the uid — monetization must never key on the
           * client-supplied scannerId, which is forgeable.
           *
           * Imported lazily: lib/supabase.ts must not be pulled in at module
           * level, which crashes iOS standalone builds.
           */
          try {
            const { supabase } = await import('@/lib/supabase');
            const at = (await supabase?.auth.getSession())?.data?.session?.access_token;
            if (at) h['x-supabase-auth'] = `Bearer ${at}`;
          } catch { /* unauthenticated or unavailable — server treats as no identity */ }

          return h;
        },
        // Custom fetch to include credentials for cookie-based auth
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
      }),
    ],
  });
}