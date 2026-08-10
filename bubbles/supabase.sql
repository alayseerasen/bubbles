-- ============================================================
-- BUBBLES — Supabase database + Storage setup
-- Вставь весь этот файл в Supabase -> SQL Editor -> Run.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- PROFILES
-- ------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique,
    display_name text not null,
    gender text not null default 'female',
    avatar text,
    cover text,
    bio text not null default '',
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- POSTS
-- ------------------------------------------------------------
create table if not exists public.posts (
    id text primary key,
    author_id uuid not null references public.profiles(id) on delete cascade,
    text text not null default '',
    image text not null default '',
    likes jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- COMMENTS
-- ------------------------------------------------------------
create table if not exists public.comments (
    id text primary key,
    post_id text not null references public.posts(id) on delete cascade,
    author_id uuid not null references public.profiles(id) on delete cascade,
    text text not null,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- FRIENDSHIPS
-- ------------------------------------------------------------
create table if not exists public.friendships (
    id text primary key,
    user1 uuid not null references public.profiles(id) on delete cascade,
    user2 uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint friendship_not_self check (user1 <> user2)
);

create unique index if not exists friendships_pair_unique
on public.friendships (least(user1,user2), greatest(user1,user2));

-- ------------------------------------------------------------
-- MESSAGES
-- ------------------------------------------------------------
create table if not exists public.messages (
    id text primary key,
    sender_id uuid not null references public.profiles(id) on delete cascade,
    receiver_id uuid not null references public.profiles(id) on delete cascade,
    text text not null,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- MUSIC
-- ------------------------------------------------------------
create table if not exists public.music (
    id text primary key,
    author_id uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    artist text not null,
    cover_url text not null default '',
    audio_url text not null,
    audio_path text not null,
    cover_path text not null default '',
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists comments_post_id_idx on public.comments(post_id);
create index if not exists messages_sender_receiver_idx on public.messages(sender_id, receiver_id, created_at);
create index if not exists music_created_at_idx on public.music(created_at desc);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.music enable row level security;

-- Profiles
 drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
 drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);
 drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Posts
 drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
 drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (auth.uid() = author_id);
 drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (auth.uid() = author_id);

-- Comments
 drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (true);
 drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check (auth.uid() = author_id);
 drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (auth.uid() = author_id);

-- Friendships
 drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select using (auth.uid() = user1 or auth.uid() = user2);
 drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships for insert with check (auth.uid() = user1 or auth.uid() = user2);
 drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete using (auth.uid() = user1 or auth.uid() = user2);

-- Messages
 drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
 drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (auth.uid() = sender_id);
 drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete using (auth.uid() = sender_id);

-- Music
 drop policy if exists music_select on public.music;
create policy music_select on public.music for select using (true);
 drop policy if exists music_insert on public.music;
create policy music_insert on public.music for insert with check (auth.uid() = author_id);
 drop policy if exists music_update on public.music;
create policy music_update on public.music for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists music_delete on public.music;
create policy music_delete on public.music for delete using (auth.uid() = author_id);

-- ------------------------------------------------------------
-- STORAGE: public bucket for MP3 + covers
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('music', 'music', true)
on conflict (id) do update set public = true;

 drop policy if exists music_storage_select on storage.objects;
create policy music_storage_select
on storage.objects for select
using (bucket_id = 'music');

 drop policy if exists music_storage_insert on storage.objects;
create policy music_storage_insert
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = auth.uid()::text
);

 drop policy if exists music_storage_update on storage.objects;
create policy music_storage_update
on storage.objects for update
to authenticated
using (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = auth.uid()::text
);

 drop policy if exists music_storage_delete on storage.objects;
create policy music_storage_delete
on storage.objects for delete
to authenticated
using (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = auth.uid()::text
);
