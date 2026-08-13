-- ============================================================
-- BUBBLES — Supabase database + Storage setup
-- Вставь весь этот файл в Supabase -> SQL Editor -> Run.
--
-- Этот файл безопасно перезапускать даже на уже существующей
-- базе: все "create table if not exists", "add column if not
-- exists" и "drop policy if exists" — ничего не удалит твои
-- старые данные (посты, друзей, музыку, сообщения).
--
-- Новое в этой версии: is_admin / is_banned на профилях, плюс
-- триггер, защищающий эти два поля от изменения кем угодно,
-- кроме уже существующего админа. Также добавлены недостающие
-- ранее таблица music_saves и колонки last_seen/current_track/
-- current_artist — если они уже есть в твоей базе, ничего не
-- изменится.
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

-- Presence / "now playing" columns (added after the initial table, kept as
-- add-column-if-not-exists so this script stays safe to re-run).
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists current_track text not null default '';
alter table public.profiles add column if not exists current_artist text not null default '';

-- ------------------------------------------------------------
-- MODERATION — admin + ban flags.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists is_banned boolean not null default false;

-- security definer so these can be called from inside RLS policies on
-- profiles itself without causing infinite recursion.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

create or replace function public.is_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select is_banned from public.profiles where id = uid), false);
$$;

-- IMPORTANT: RLS alone would let anyone flip their OWN is_admin/is_banned
-- to whatever they want (the update policy allows editing your own row —
-- RLS can't restrict individual columns). This trigger silently reverts
-- those two fields back to their previous value unless the person making
-- the change is already an admin.
create or replace function public.protect_profile_moderation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (new.is_admin is distinct from old.is_admin or new.is_banned is distinct from old.is_banned)
       and not public.is_admin(auth.uid()) then
        new.is_admin := old.is_admin;
        new.is_banned := old.is_banned;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_profile_moderation_fields on public.profiles;
create trigger protect_profile_moderation_fields
before update on public.profiles
for each row execute function public.protect_profile_moderation_fields();

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

-- Lets a comment be a reply to another comment. Replies-to-replies are
-- flattened onto the original top-level comment by the app (like
-- Instagram/Facebook), so this never nests more than one level deep.
alter table public.comments add column if not exists parent_comment_id text references public.comments(id) on delete cascade;

-- ------------------------------------------------------------
-- POST LIKES
-- One row per (post, user) so RLS can let ANYONE add/remove their own
-- like, instead of requiring an update on the whole post row (which
-- only the post's author is allowed to do).
-- ------------------------------------------------------------
create table if not exists public.post_likes (
    post_id text not null references public.posts(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, user_id)
);

-- ------------------------------------------------------------
-- COMMENT LIKES — same one-row-per-(comment,user) pattern as post_likes.
-- ------------------------------------------------------------
create table if not exists public.comment_likes (
    comment_id text not null references public.comments(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (comment_id, user_id)
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
    created_at timestamptz not null default now(),
    read_at timestamptz
);

-- Adds read_at to installs that already had the messages table without it.
alter table public.messages add column if not exists read_at timestamptz;

-- ------------------------------------------------------------
-- FRIEND REQUESTS (new — pending/accepted/declined handshake)
-- Accepted requests still create a row in public.friendships,
-- exactly like the old instant "add friend" button used to.
-- ------------------------------------------------------------
create table if not exists public.friend_requests (
    id text primary key,
    from_user uuid not null references public.profiles(id) on delete cascade,
    to_user uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending','accepted','declined')),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    constraint friend_request_not_self check (from_user <> to_user)
);

-- Only one active (pending) request per direction between two people.
create unique index if not exists friend_requests_pending_unique
on public.friend_requests (from_user, to_user)
where status = 'pending';

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
-- MUSIC SAVES — lets anyone add another person's uploaded track
-- to their own "Моя музыка" without re-uploading the file.
-- ------------------------------------------------------------
create table if not exists public.music_saves (
    music_id text not null references public.music(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (music_id, user_id)
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists comments_post_id_idx on public.comments(post_id);
create index if not exists comments_parent_comment_id_idx on public.comments(parent_comment_id);
create index if not exists post_likes_post_id_idx on public.post_likes(post_id);
create index if not exists comment_likes_comment_id_idx on public.comment_likes(comment_id);
create index if not exists messages_sender_receiver_idx on public.messages(sender_id, receiver_id, created_at);
create index if not exists music_created_at_idx on public.music(created_at desc);
create index if not exists friend_requests_to_user_idx on public.friend_requests(to_user, status);
create index if not exists friend_requests_from_user_idx on public.friend_requests(from_user, status);
create index if not exists music_saves_user_idx on public.music_saves(user_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.music enable row level security;
alter table public.friend_requests enable row level security;
alter table public.post_likes enable row level security;
alter table public.comment_likes enable row level security;
alter table public.music_saves enable row level security;

-- Profiles
 drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
 drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);
 drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
using (auth.uid() = id or public.is_admin(auth.uid()))
with check (auth.uid() = id or public.is_admin(auth.uid()));

-- Posts
 drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
 drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (auth.uid() = author_id and not public.is_banned(auth.uid()));
 drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Comments
 drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (true);
 drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check (auth.uid() = author_id and not public.is_banned(auth.uid()));
 drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Post likes
 drop policy if exists post_likes_select on public.post_likes;
create policy post_likes_select on public.post_likes for select using (true);
 drop policy if exists post_likes_insert on public.post_likes;
create policy post_likes_insert on public.post_likes for insert with check (auth.uid() = user_id and not public.is_banned(auth.uid()));
 drop policy if exists post_likes_delete on public.post_likes;
create policy post_likes_delete on public.post_likes for delete using (auth.uid() = user_id);

-- Comment likes
 drop policy if exists comment_likes_select on public.comment_likes;
create policy comment_likes_select on public.comment_likes for select using (true);
 drop policy if exists comment_likes_insert on public.comment_likes;
create policy comment_likes_insert on public.comment_likes for insert with check (auth.uid() = user_id and not public.is_banned(auth.uid()));
 drop policy if exists comment_likes_delete on public.comment_likes;
create policy comment_likes_delete on public.comment_likes for delete using (auth.uid() = user_id);

-- Friendships
 drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select using (auth.uid() = user1 or auth.uid() = user2);
 drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships for insert with check ((auth.uid() = user1 or auth.uid() = user2) and not public.is_banned(auth.uid()));
 drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete using (auth.uid() = user1 or auth.uid() = user2);

-- Messages
 drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
 drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (auth.uid() = sender_id and not public.is_banned(auth.uid()));
 drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update
using (auth.uid() = sender_id or auth.uid() = receiver_id)
with check (auth.uid() = sender_id or auth.uid() = receiver_id);
 drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete using (auth.uid() = sender_id);

-- Friend requests
 drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select
using (auth.uid() = from_user or auth.uid() = to_user);
 drop policy if exists friend_requests_insert on public.friend_requests;
create policy friend_requests_insert on public.friend_requests for insert
with check (auth.uid() = from_user and not public.is_banned(auth.uid()));
 drop policy if exists friend_requests_update on public.friend_requests;
create policy friend_requests_update on public.friend_requests for update
using (auth.uid() = from_user or auth.uid() = to_user)
with check (auth.uid() = from_user or auth.uid() = to_user);
 drop policy if exists friend_requests_delete on public.friend_requests;
create policy friend_requests_delete on public.friend_requests for delete
using (auth.uid() = from_user or auth.uid() = to_user);

-- Music
 drop policy if exists music_select on public.music;
create policy music_select on public.music for select using (true);
 drop policy if exists music_insert on public.music;
create policy music_insert on public.music for insert with check (auth.uid() = author_id and not public.is_banned(auth.uid()));
 drop policy if exists music_update on public.music;
create policy music_update on public.music for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists music_delete on public.music;
create policy music_delete on public.music for delete using (auth.uid() = author_id or public.is_admin(auth.uid()));

-- Music saves
 drop policy if exists music_saves_select on public.music_saves;
create policy music_saves_select on public.music_saves for select using (true);
 drop policy if exists music_saves_insert on public.music_saves;
create policy music_saves_insert on public.music_saves for insert with check (auth.uid() = user_id and not public.is_banned(auth.uid()));
 drop policy if exists music_saves_delete on public.music_saves;
create policy music_saves_delete on public.music_saves for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- REALTIME — make sure Supabase actually broadcasts changes on
-- these tables. Without this, live messages / friend requests /
-- likes / comments will silently just not update until refresh.
-- Safe to run repeatedly.
-- ------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
        alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_requests'
    ) then
        alter publication supabase_realtime add table public.friend_requests;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
    ) then
        alter publication supabase_realtime add table public.posts;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
    ) then
        alter publication supabase_realtime add table public.comments;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_likes'
    ) then
        alter publication supabase_realtime add table public.post_likes;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comment_likes'
    ) then
        alter publication supabase_realtime add table public.comment_likes;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
        alter publication supabase_realtime add table public.profiles;
    end if;
end $$;

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
