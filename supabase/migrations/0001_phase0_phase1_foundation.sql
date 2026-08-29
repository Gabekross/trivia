create extension if not exists "pgcrypto";

create type session_status as enum ('LOBBY', 'QUESTION_ACTIVE', 'QUESTION_LOCKED', 'ANSWER_REVEAL', 'LEADERBOARD', 'WINNER_FOUND', 'PAUSED', 'ENDED');
create type player_status as enum ('ACTIVE', 'ELIMINATED', 'WINNER', 'SPECTATOR', 'DISCONNECTED');
create type question_status as enum ('DRAFT', 'APPROVED', 'ARCHIVED');

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  prompt text not null,
  explanation text,
  difficulty text not null default 'medium',
  status question_status not null default 'DRAFT',
  source_type text not null default 'manual',
  created_at timestamptz not null default now()
);

create table question_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  label text not null,
  choice_order integer not null,
  text text not null,
  is_correct boolean not null default false,
  unique (question_id, choice_order),
  unique (question_id, label)
);

create table game_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  configuration jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  join_code text not null,
  status session_status not null default 'LOBBY',
  configuration_snapshot jsonb not null,
  current_session_question_id uuid,
  winner_player_id uuid,
  winner_state jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index sessions_active_join_code_idx on sessions (join_code)
where status not in ('ENDED');

create table session_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  display_name text not null,
  status player_status not null default 'ACTIVE',
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  streak integer not null default 0,
  lives integer not null default 3,
  points integer not null default 0,
  join_order integer not null,
  reconnect_token_hash text,
  created_at timestamptz not null default now(),
  unique (session_id, join_order)
);

create table session_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  question_id uuid not null references questions(id),
  question_order integer not null,
  activated_at timestamptz,
  closed_at timestamptz,
  revealed_at timestamptz,
  unique (session_id, question_order)
);

alter table sessions
  add constraint sessions_current_question_fk
  foreign key (current_session_question_id) references session_questions(id);

create table player_answers (
  id uuid primary key default gen_random_uuid(),
  session_question_id uuid not null references session_questions(id) on delete cascade,
  player_id uuid not null references session_players(id) on delete cascade,
  selected_choice_id uuid not null references question_choices(id),
  idempotency_key text,
  accepted_at timestamptz not null default now(),
  response_ms integer not null,
  is_correct boolean not null,
  unique (session_question_id, player_id),
  unique (idempotency_key)
);

create table session_winners (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  player_id uuid not null references session_players(id),
  rule_type text not null,
  placement integer not null default 1,
  winning_session_question_id uuid references session_questions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index session_winners_single_winner_idx on session_winners (session_id, placement)
where placement = 1;

create index questions_category_status_idx on questions (category_id, status);
create index sessions_status_idx on sessions (status);
create index session_players_session_status_idx on session_players (session_id, status);
create index player_answers_question_player_idx on player_answers (session_question_id, player_id);
create index player_answers_player_idx on player_answers (player_id);
create index session_winners_session_idx on session_winners (session_id);

alter table categories enable row level security;
alter table questions enable row level security;
alter table question_choices enable row level security;
alter table game_templates enable row level security;
alter table sessions enable row level security;
alter table session_players enable row level security;
alter table session_questions enable row level security;
alter table player_answers enable row level security;
alter table session_winners enable row level security;

-- Phase 1 posture: clients read through safe views/RPCs, and trusted backend mutations use service role.
create policy "public approved categories" on categories for select using (active = true);
create policy "public approved questions" on questions for select using (status = 'APPROVED');
create policy "service role manages categories" on categories for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages questions" on questions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages choices" on question_choices for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages templates" on game_templates for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages sessions" on sessions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages players" on session_players for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages session questions" on session_questions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages answers" on player_answers for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages winners" on session_winners for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
