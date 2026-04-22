-- Migration 001: duplicate detection columns
-- Run in Supabase SQL Editor

alter table items
  add column if not exists duplicate_suspect boolean not null default false,
  add column if not exists duplicate_of uuid references items(id) on delete set null;

create index if not exists items_duplicate_idx on items(duplicate_suspect) where duplicate_suspect = true;
