-- Auth + RBAC for Madam Yen IMS
-- Run this in Supabase SQL Editor (public schema).

-- 1) Users table
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) OCR job ownership
alter table public.ocr_jobs
  add column if not exists created_by uuid null references public.app_users(id);

create index if not exists ocr_jobs_created_by_created_at_idx
  on public.ocr_jobs (created_by, created_at desc);

-- 3) Seed admin user (replace placeholders)
-- Generate password_hash via: `node scripts/gen-password-hash.mjs "<plain_password>"`
-- Example:
-- insert into public.app_users (username, password_hash, role)
-- values ('admin', '$2a$10$........', 'admin')
-- on conflict (username) do nothing;

