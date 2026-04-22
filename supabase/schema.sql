-- =============================================
-- AI Learning Database — Supabase Schema
-- =============================================

-- Categories (支援巢狀分類)
create table if not exists categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      text not null unique,
  parent_id uuid references categories(id) on delete set null,
  color     text not null default '#6366f1',
  icon      text,
  description text,
  created_at timestamptz default now()
);

-- Items (新聞 / Repo / 手動筆記)
create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('news','repo','note')),
  title       text not null,
  url         text,
  summary     text,
  content     text,
  category_id uuid references categories(id) on delete set null,
  source      text,
  metadata    jsonb default '{}',
  quality     smallint check (quality between 1 and 5),
  is_pinned   boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Tags
create table if not exists tags (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  color text not null default '#94a3b8'
);

-- Item ↔ Tag (多對多)
create table if not exists item_tags (
  item_id uuid references items(id) on delete cascade,
  tag_id  uuid references tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

-- Item 關聯 (知識圖譜邊)
create table if not exists item_relations (
  source_id     uuid references items(id) on delete cascade,
  target_id     uuid references items(id) on delete cascade,
  relation_type text not null default 'related',
  note          text,
  created_at    timestamptz default now(),
  primary key (source_id, target_id)
);

-- 每日審查紀錄
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete set null,
  model       text not null,
  items_checked int default 0,
  avg_quality numeric(3,2),
  notes       text,
  created_at  timestamptz default now()
);

-- =============================================
-- Indexes
-- =============================================
create index if not exists items_type_idx       on items(type);
create index if not exists items_category_idx   on items(category_id);
create index if not exists items_created_idx    on items(created_at desc);
create index if not exists item_tags_tag_idx    on item_tags(tag_id);

-- =============================================
-- Full-text search
-- =============================================
alter table items add column if not exists fts tsvector
  generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,''))
  ) stored;

create index if not exists items_fts_idx on items using gin(fts);

-- =============================================
-- updated_at trigger
-- =============================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_updated_at
  before update on items
  for each row execute function set_updated_at();

-- =============================================
-- Row Level Security (public read for now)
-- =============================================
alter table categories    enable row level security;
alter table items         enable row level security;
alter table tags          enable row level security;
alter table item_tags     enable row level security;
alter table item_relations enable row level security;
alter table reviews       enable row level security;

-- anon 可讀全部（個人用途）
create policy "public read categories"     on categories     for select using (true);
create policy "public read items"          on items          for select using (true);
create policy "public read tags"           on tags           for select using (true);
create policy "public read item_tags"      on item_tags      for select using (true);
create policy "public read item_relations" on item_relations for select using (true);
create policy "public read reviews"        on reviews        for select using (true);

-- service_role key 可寫（給 GitHub Actions 用）
create policy "service write categories"     on categories     for all using (true);
create policy "service write items"          on items          for all using (true);
create policy "service write tags"           on tags           for all using (true);
create policy "service write item_tags"      on item_tags      for all using (true);
create policy "service write item_relations" on item_relations for all using (true);
create policy "service write reviews"        on reviews        for all using (true);

-- =============================================
-- Seed: 預設分類
-- =============================================
insert into categories (name, slug, color, icon, description) values
  ('AI 模型',      'ai-models',      '#6366f1', '🧠', 'LLM、Vision、Audio 等模型進展'),
  ('工具與框架',   'tools-frameworks','#0ea5e9', '🔧', 'AI 開發工具、SDK、框架'),
  ('研究論文',     'research',        '#10b981', '📄', '值得關注的 AI 研究'),
  ('產業動態',     'industry',        '#f59e0b', '🏢', '公司、融資、政策'),
  ('開源專案',     'open-source',     '#ec4899', '⭐', 'GitHub 熱門開源 AI 專案'),
  ('學習資源',     'learning',        '#8b5cf6', '📚', '教學、課程、文章'),
  ('實作筆記',     'notes',           '#64748b', '📝', '個人實作心得與筆記')
on conflict (slug) do nothing;
