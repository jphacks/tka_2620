// The bits every engine route needs: the caller's token, a Supabase client that runs as that caller, and the error
// body from lib/contracts.ts. RLS then decides what the request may read and write, exactly as it would in the
// browser (docs/SPEC.md → Auth). The service-role key belongs to scripts/ only and is never used here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ApiErrorCode } from "@/lib/contracts";

// docs/SPEC.md → Errors: the HTTP status says the same as the code.
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unredacted: 422,
  unavailable: 503,
};

// A failure the route turns into an ApiError body. It carries a code only: never a message, which could hold a
// question or a note body (no text goes to logs — docs/SPEC.md → Scope rules).
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(code);
    this.name = "ApiFailure";
    this.code = code;
  }
}

export function apiError(code: ApiErrorCode): Response {
  return Response.json({ error: code }, { status: ERROR_STATUS[code] });
}

// The signed-in caller's access token, or null when the request isn't authenticated.
export function callerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  return match ? match[1].trim() : null;
}

// A client that acts as the caller: the anon key says which project, the token says who. Posts and reads then go
// through the caller's own policies, so no route has to re-check scope itself.
export function callerClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiFailure("unavailable");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// A PostgREST or PostgreSQL error, which never reaches the response or the log as text. 42501 is what the policies
// and the live-loop functions raise when the caller may not do this.
export function dbFailure(error: { code?: string } | null): ApiFailure {
  return new ApiFailure(error?.code === "42501" ? "forbidden" : "unavailable");
}
