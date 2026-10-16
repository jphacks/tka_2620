-- 0001_tables: the data model from docs/SPEC.md (tables, indexes, embeddings), with RLS on and no policies.
-- The policies, the scoped search function and the Realtime publication are Hack Day work (F1-F4).

create extension if not exists vector with schema extensions;

-- Where seats live -------------------------------------------------------------

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null
);
create index groups_institution_id_idx on public.groups (institution_id);

-- Seat types differ only in their label pack (messages/*.json) and settings (noteExpiry,
-- groupOwnsCriticalNotes, requiredPrompts). New types extend the seat_type check in a new migration.
create table public.seats (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  slug text not null unique,
  name text not null,
  seat_type text not null check (seat_type in ('club_role', 'exchange_route', 'lab_duty')),
  settings jsonb not null default '{}'
);
create index seats_group_id_idx on public.seats (group_id);

-- Who holds what ---------------------------------------------------------------

create table public.group_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  status text not null check (status in ('current', 'alumni')),
  primary key (user_id, group_id)
);
create index group_members_group_id_idx on public.group_members (group_id);

-- reachable: an alumni holder agreed to receive newcomers' unanswered questions.
create table public.seat_holders (
  user_id uuid not null references auth.users (id) on delete cascade,
  seat_id uuid not null references public.seats (id) on delete cascade,
  term_label text not null,
  term_order integer not null,
  status text not null check (status in ('current', 'alumni')),
  reachable boolean not null default false,
  primary key (user_id, seat_id, term_order)
);
create index seat_holders_seat_id_term_order_idx on public.seat_holders (seat_id, term_order);

-- Notes ------------------------------------------------------------------------

-- Text ids, so seed notes keep the readable ids that seed/questions.csv cites (smash-2025-hokenjo);
-- new notes get a uuid. author_user_id is cleared when a group keeps a critical note (groupOwnsCriticalNotes).
create table public.notes (
  id text primary key default gen_random_uuid()::text,
  seat_id uuid not null references public.seats (id) on delete cascade,
  term_order integer not null,
  author_user_id uuid references auth.users (id) on delete set null,
  byline text not null,
  kind text not null check (kind in ('deadline', 'contact', 'rule_of_thumb', 'pitfall', 'unwritten_rule')),
  title text not null,
  body text not null,
  deadline_date date,
  lang text not null check (lang in ('ja', 'en')),
  scope text not null default 'successor' check (scope in ('successor', 'group', 'institution', 'public')),
  status text not null default 'live' check (status in ('live', 'withdrawn')),
  critical boolean not null default false,
  valid_until date,
  source text not null check (source in ('handover', 'live', 'import', 'file', 'chat')),
  provenance text, -- the source without names, e.g. 「LINEグループ・2024年10月」
  superseded_by text references public.notes (id) on delete set null,
  embedding vector(1024), -- bge-m3
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  constraint notes_deadline_has_date check (kind <> 'deadline' or deadline_date is not null),
  constraint notes_withdrawn_has_time check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create index notes_seat_id_idx on public.notes (seat_id);
create index notes_author_user_id_idx on public.notes (author_user_id);
create index notes_superseded_by_idx on public.notes (superseded_by);
create index notes_embedding_idx on public.notes using hnsw (embedding vector_cosine_ops);

-- Questions and the live loop --------------------------------------------------

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  asker_user_id uuid not null references auth.users (id) on delete cascade,
  seat_id uuid not null references public.seats (id) on delete cascade,
  text text not null,
  lang text not null check (lang in ('ja', 'en')),
  status text not null default 'waiting' check (status in ('answered', 'waiting')),
  prompt_id uuid, -- the demand prompt it was merged into; the foreign key follows the prompts table
  created_at timestamptz not null default now()
);
create index questions_asker_user_id_idx on public.questions (asker_user_id);
create index questions_seat_id_idx on public.questions (seat_id);
create index questions_prompt_id_idx on public.questions (prompt_id);

-- The latest answer per question (an AskResult), for the asker only.
create table public.answers (
  question_id uuid primary key references public.questions (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references public.seats (id) on delete cascade,
  kind text not null check (kind in ('core', 'demand', 'gap', 'required')),
  text text not null,
  ask_count integer not null default 0,
  source_question_id uuid references public.questions (id) on delete set null,
  retired boolean not null default false
);
create index prompts_seat_id_idx on public.prompts (seat_id);
create index prompts_source_question_id_idx on public.prompts (source_question_id);

-- Every question merged into a demand prompt points at it, so publishing re-answers all of them, not just the first.
alter table public.questions
  add constraint questions_prompt_id_fkey foreign key (prompt_id) references public.prompts (id) on delete set null;

-- A demand prompt delivered to a reachable predecessor's inbox.
create table public.prompt_routes (
  prompt_id uuid not null references public.prompts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (prompt_id, user_id)
);
create index prompt_routes_user_id_idx on public.prompt_routes (user_id);

-- Metrics ----------------------------------------------------------------------

-- Meter, leak test, live-loop timings and redaction counts: numbers only, never note, chat or canary text.
create table public.events (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_kind_created_at_idx on public.events (kind, created_at);

-- Row level security -----------------------------------------------------------

-- On, with no policies: anon and signed-in users can't read or write anything until F1 adds the policies.
-- The service role (scripts/) and the SQL editor bypass RLS.
alter table public.institutions enable row level security;
alter table public.groups enable row level security;
alter table public.seats enable row level security;
alter table public.group_members enable row level security;
alter table public.seat_holders enable row level security;
alter table public.notes enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.prompts enable row level security;
alter table public.prompt_routes enable row level security;
alter table public.events enable row level security;
