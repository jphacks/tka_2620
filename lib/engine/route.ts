// Shared by the route handlers in app/api/: they act as the caller, so RLS and the search function run as that user.
// The service-role key is never used here (scripts/ only). A failure carries a code, never a message: a message can
// quote a question, an answer or a note body, and none of those may reach a response or a log.
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

// A failure the route answers with its code.
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(code);
    this.name = "ApiFailure";
    this.code = code;
  }
}

// A PostgREST or PostgreSQL error as a failure. 42501 is what the policies and the live-loop functions raise when the
// caller may not do this.
export function dbFailure(error: { code?: string } | null): ApiFailure {
  return new ApiFailure(error?.code === "42501" ? "forbidden" : "unavailable");
}

// The answer to a request that threw: an ApiFailure's code, otherwise unavailable. The log line has the code and the
// error's class name only.
export function failed(route: string, error: unknown): Response {
  const code = error instanceof ApiFailure ? error.code : "unavailable";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`${route} failed: ${code} (${name})`);
  return apiError(code);
}

// The access token in the request's Authorization: Bearer header.
export function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

export type Caller = { db: SupabaseClient; userId: string };

// The signed-in user behind an access token, with a Supabase client that acts as them; undefined when the token isn't
// a signed-in user's (malformed, expired, or the anon key). Verified locally against the project's signing keys when
// they're asymmetric, otherwise by the Auth server. Throws when Supabase can't be reached, so the route answers
// unavailable rather than unauthorized.
export async function callerFor(token: string): Promise<Caller | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiFailure("unavailable");
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getClaims(token);
  if (isAuthRetryableFetchError(error)) throw new ApiFailure("unavailable");
  const userId = data?.claims.sub;
  return userId ? { db, userId } : undefined;
}
