-- ============================================================
-- TO DO LIST · Supabase 初始化 SQL
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行一次即可
-- ============================================================

-- 1) 任务表
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  username    text        not null,
  title       text        not null,
  note        jsonb       default '{"text":"","images":[],"links":[]}'::jsonb,
  task_date   date        not null,
  deadline    timestamptz,
  tags        text[]      default '{}',
  done        boolean     default false,
  done_at     timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists todos_username_idx on public.todos (username);
create index if not exists todos_date_idx     on public.todos (username, task_date);

-- 2) 自定义标签表
create table if not exists public.todo_tags (
  username   text not null,
  name       text not null,
  created_at timestamptz default now(),
  primary key (username, name)
);

-- 3) RLS：允许匿名 key 读写（本应用用用户名做隔离，不接 auth）
alter table public.todos     enable row level security;
alter table public.todo_tags enable row level security;

drop policy if exists "anon_all_todos" on public.todos;
create policy "anon_all_todos" on public.todos
  for all to anon using (true) with check (true);

drop policy if exists "anon_all_todo_tags" on public.todo_tags;
create policy "anon_all_todo_tags" on public.todo_tags
  for all to anon using (true) with check (true);

-- 4) 备注图片用的存储桶（公开读）
insert into storage.buckets (id, name, public)
values ('todo-images', 'todo-images', true)
on conflict (id) do nothing;

drop policy if exists "anon_todo_images" on storage.objects;
create policy "anon_todo_images" on storage.objects
  for all to anon
  using (bucket_id = 'todo-images')
  with check (bucket_id = 'todo-images');
