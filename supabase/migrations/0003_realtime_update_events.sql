create table if not exists game_update_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists game_update_events_session_created_idx
on game_update_events (session_id, created_at desc);

alter table game_update_events enable row level security;

create policy "public can read realtime game update events"
on game_update_events
for select
using (true);

create policy "service role manages realtime game update events"
on game_update_events
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_update_events'
  ) then
    alter publication supabase_realtime add table game_update_events;
  end if;
end $$;
