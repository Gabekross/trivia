create table if not exists game_state_snapshots (
  id text primary key default 'primary',
  state jsonb not null default '{"sessions":[]}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into game_state_snapshots (id, state)
values ('primary', '{"sessions":[]}'::jsonb)
on conflict (id) do nothing;

create table if not exists game_session_index (
  session_id text primary key,
  join_code text not null,
  status text not null,
  title text not null,
  player_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists game_session_index_join_code_idx
on game_session_index (join_code)
where status <> 'ENDED';

alter table game_state_snapshots enable row level security;
alter table game_session_index enable row level security;

create policy "service role manages game state snapshots"
on game_state_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages game session index"
on game_session_index
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
