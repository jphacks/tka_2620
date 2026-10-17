// Shared by the route handlers in app/api/: they act as the caller, so RLS and the search function run as that user.
// The service-role key is never used here (scripts/ only).
import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { ApiError, ApiErrorCode } from "@/lib/contracts";

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unredacted: 422,
  unavailable: 503,
};

export function apiError(error: ApiErrorCode): Response {
  return Response.json({ error } satisfies ApiError, {
    status: STATUS[error],
  });
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

// A Supabase client signed in as the caller of this request, or undefined when it carries no valid access token.
// Throws when Supabase can't be reached, so the route answers unavailable rather than unauthorized.
export async function callerClient(
  request: Request,
): Promise<SupabaseClient | undefined> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return undefined;
  const db = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  // Verified locally against the project's signing keys when they're asymmetric, otherwise by the Auth server.
  const { data, error } = await db.auth.getClaims(token);
  if (isAuthRetryableFetchError(error)) throw error;
  return data?.claims.sub ? db : undefined;
}
