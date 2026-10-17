// The real Api (lib/contracts.ts → Api) for one signed-in Supabase client: the counterpart of createMockApi in
// lib/mocks.ts, so a screen switches by being handed this instead. Every call goes to an API route with this client's
// access token, so the route acts as this user and RLS decides (AGENTS.md → Rules); Realtime subscribes on the same
// client, so a row reaches it only when this user may read it. A failed call throws ApiClientError with the route's
// code, like MockApiError, so `ApiError.safeParse(error)` works on both.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  AnswersRow,
  type Api,
  ApiError,
  type ApiErrorCode,
  AskResult,
  type ConsolePersona,
  ConsoleSession,
  DraftResponse,
  EventsRow,
  ImportResponse,
  InboxResponse,
  MyNotesResponse,
  NotesRow,
  PromptRoutesRow,
  PromptsResponse,
  PublishResponse,
  ReadersResponse,
  type RealtimeRows,
  SeatView,
  SeenResponse,
  WithdrawResponse,
} from "@/lib/contracts";

export class ApiClientError extends Error {
  readonly error: ApiErrorCode;
  constructor(error: ApiErrorCode) {
    super(error);
    this.name = "ApiClientError";
    this.error = error;
  }
}

// The route's answer checked against its contract: an error body becomes its code, and an answer that doesn't match
// the contract is unavailable (a screen never renders an unchecked shape).
async function answer<S extends z.ZodType>(
  response: Response,
  schema: S,
): Promise<z.output<S>> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiClientError(
      ApiError.safeParse(body).data?.error ?? "unavailable",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiClientError("unavailable");
  return parsed.data;
}

// Each channel is the table of the same name (supabase/migrations: the supabase_realtime publication sends inserts
// and updates only). Rows are checked like answers; a row that doesn't match is dropped, never shown.
const ROWS: { [C in keyof RealtimeRows]: z.ZodType<RealtimeRows[C]> } = {
  answers: AnswersRow,
  prompt_routes: PromptRoutesRow,
  notes: NotesRow,
  events: EventsRow,
};

export function createApi(db: SupabaseClient): Api {
  // GET without a body, POST with one.
  async function call<S extends z.ZodType>(
    schema: S,
    path: string,
    body?: unknown,
  ): Promise<z.output<S>> {
    const { data } = await db.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ApiClientError("unauthorized");
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return answer(response, schema);
  }
  const query = (params: Record<string, string>) =>
    new URLSearchParams(params).toString();

  return {
    seat: (slug) => call(SeatView, `/api/seats/${encodeURIComponent(slug)}`),
    ask: (request) => call(AskResult, "/api/ask", request),
    inbox: ({ seat }) => call(InboxResponse, `/api/inbox?${query({ seat })}`),
    seen: (request) => call(SeenResponse, "/api/inbox/seen", request),
    draft: (request) => call(DraftResponse, "/api/handover/draft", request),
    publish: (request) =>
      call(PublishResponse, "/api/handover/publish", request),
    prompts: ({ seat }) =>
      call(PromptsResponse, `/api/handover/prompts?${query({ seat })}`),
    readers: ({ seat, scope }) =>
      call(ReadersResponse, `/api/handover/readers?${query({ seat, scope })}`),
    import: (request) => call(ImportResponse, "/api/import", request),
    withdraw: (noteId) =>
      call(
        WithdrawResponse,
        `/api/notes/${encodeURIComponent(noteId)}/withdraw`,
        {},
      ),
    myNotes: () => call(MyNotesResponse, "/api/me/notes"),
    subscribe(channel, onRow) {
      const subscription = db
        .channel(`${channel}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: channel },
          (change) => {
            const row = ROWS[channel].safeParse(change.new);
            if (row.success) onRow(row.data);
          },
        )
        .subscribe();
      return () => {
        void db.removeChannel(subscription);
      };
    },
  };
}

// One console pane's own client (docs/SPEC.md → Console panes): the persona's session from POST /api/console/session,
// kept in memory only (persistSession: false) under its own storage key, so three personas run side by side in one
// tab and none of them is the page's signed-in user. key: the console passphrase (CONSOLE_SIGN_IN on the server).
export async function signInConsolePane(
  persona: ConsolePersona,
  key: string,
): Promise<Api> {
  const response = await fetch("/api/console/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-console-key": key },
    body: JSON.stringify({ persona }),
  });
  const session = await answer(response, ConsoleSession);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiClientError("unavailable");
  const db = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: `daidai-console-${persona}`,
    },
  });
  const { error } = await db.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) throw new ApiClientError("unauthorized");
  return createApi(db);
}
