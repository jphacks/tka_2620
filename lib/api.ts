// The real Api (lib/contracts.ts → Api) for one signed-in Supabase client: the counterpart of createMockApi in
// lib/mocks.ts, so a screen switches by being handed this instead. Every call goes to an API route with this client's
// access token, so the route acts as this user and RLS decides (AGENTS.md → Rules); Realtime subscribes on the same
// client, so a row reaches it only when this user may read it. A failed call throws ApiClientError with the route's
// code, like MockApiError, so `ApiError.safeParse(error)` works on both.
import {
  createClient,
  isAuthApiError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { z } from "zod";
import {
  AnswersRow,
  type Api,
  ApiError,
  type ApiErrorCode,
  AskResult,
  type ConsolePersona,
  ConsoleSession,
  DEMO_EMAIL,
  DemoAccount,
  DraftResponse,
  EventsRow,
  GapResponse,
  ImportResponse,
  InboxResponse,
  MyNotesResponse,
  NotesRow,
  NoteView,
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
    gap: (request) => call(GapResponse, "/api/handover/prompts", request),
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
    note: (noteId) =>
      call(NoteView, `/api/notes/${encodeURIComponent(noteId)}`),
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

// Demo sign-in (F7.4, #86; docs/SPEC.md → Auth): Supabase's own email and password, one session per device. Every
// seat page on this device shares the session under DEVICE; a console pane keeps its own under its own storage key
// (#89). The session lives in localStorage and refreshes itself, so a reload or a closed tab keeps it. Nobody signs
// up: only the demo accounts sign in (lib/contracts.ts → DEMO_EMAIL), and sign-ups are off in Supabase Auth, since
// the anon key is public.
const DEVICE = "daidai-session";

// One client per storage key: two clients on one key would race over its session (supabase-js warns about that).
const clients = new Map<string, SupabaseClient>();

function sessionClient(storageKey: string): SupabaseClient {
  const known = clients.get(storageKey);
  if (known) return known;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiClientError("unavailable");
  const db = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No #access_token=… from the address bar: a link never signs a device in.
      detectSessionInUrl: false,
      storageKey,
    },
  });
  clients.set(storageKey, db);
  return db;
}

// Auth answered and said no (as opposed to not answering, or a rate limit).
function refused(error: unknown): boolean {
  return (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429)
  );
}

export type SignedIn = { account: DemoAccount; api: Api };

// Signs this device (or the pane under storageKey) in as a demo account. The password goes to Supabase Auth and
// nowhere else. A password Auth turns down is unauthorized, so the screen can ask again; offline, a rate limit or
// anything else is unavailable.
export async function signIn(
  account: DemoAccount,
  password: string,
  storageKey = DEVICE,
): Promise<SignedIn> {
  const db = sessionClient(storageKey);
  const { data, error } = await db.auth.signInWithPassword({
    email: DEMO_EMAIL[account],
    password,
  });
  if (error || !data.session) {
    throw new ApiClientError(refused(error) ? "unauthorized" : "unavailable");
  }
  return { account, api: createApi(db) };
}

// The session this device (or pane) already has, checked with Supabase Auth: the routes verify a token on their own,
// so a token whose user `pnpm demo:reset` has deleted would pass them for up to an hour and see nothing. Undefined
// when there is no session, or when Auth turns it down (reset, or ended elsewhere); such a session is cleared here, so
// the screen asks for the password again. Offline is unavailable, and the session stays for the next try. A user
// outside the demo accounts counts as signed out.
export async function signedIn(
  storageKey = DEVICE,
): Promise<SignedIn | undefined> {
  const db = sessionClient(storageKey);
  // Refreshes an expired access token first; a refresh Auth turns down clears the session.
  const { data: stored, error: storedError } = await db.auth.getSession();
  if (storedError && !refused(storedError)) {
    throw new ApiClientError("unavailable");
  }
  if (!stored.session) return undefined;
  const { data, error } = await db.auth.getUser();
  if (error && !refused(error)) throw new ApiClientError("unavailable");
  const account = DemoAccount.options.find(
    (key) => DEMO_EMAIL[key] === data.user?.email,
  );
  if (error || !account) {
    await signOut(storageKey);
    return undefined;
  }
  return { account, api: createApi(db) };
}

// Signs this device (or pane) out, and nothing else: the default scope would end the account's sessions on every
// device, the demo phone's too. The session leaves this device even when Auth can't be reached.
export async function signOut(storageKey = DEVICE): Promise<void> {
  await sessionClient(storageKey).auth.signOut({ scope: "local" });
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
