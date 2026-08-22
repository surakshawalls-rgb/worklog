-- Stores opt-in call-log metadata and background-location points.
create extension if not exists pgcrypto;

create table if not exists public.device_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(id) on delete cascade,
  event_type text not null check (event_type in ('call_log', 'location')),
  occurred_at timestamptz not null,
  call_direction text check (call_direction in ('incoming', 'outgoing', 'missed', 'rejected', 'blocked')),
  counterparty_number text,
  call_duration_seconds integer check (call_duration_seconds is null or call_duration_seconds >= 0),
  latitude double precision,
  longitude double precision,
  accuracy_meters real check (accuracy_meters is null or accuracy_meters >= 0),
  device_event_id text not null,
  source text not null default 'android',
  created_at timestamptz not null default now(),
  constraint device_activity_event_shape check (
    (event_type = 'call_log' and latitude is null and longitude is null) or
    (event_type = 'location' and call_direction is null and counterparty_number is null
      and call_duration_seconds is null and latitude is not null and longitude is not null)
  ),
  constraint uq_device_activity_events_device_event unique (user_id, device_event_id)
);

create index if not exists idx_device_activity_events_user_time
  on public.device_activity_events (user_id, occurred_at desc);

-- This project currently uses custom client-side authentication and disables RLS on its app tables.
-- Keep this setting only until uploads are moved behind an authenticated Edge Function.
alter table public.device_activity_events disable row level security;
