-- ============================================================
-- BUBBLES — Supabase database + Storage setup
-- Вставь весь этот файл в Supabase -> SQL Editor -> Run.
--
-- Этот файл безопасно перезапускать даже на уже существующей
-- базе: все "create table if not exists", "add column if not
-- exists" и "drop policy if exists" — ничего не удалит твои
-- старые данные (посты, друзей, музыку, сообщения).
-- Новое в этой версии: таблица friend_requests (заявки в
-- друзья) и колонка read_at в messages (прочитано/не прочитано).
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

-- E2E-шифрование сообщений (старая схема, ECDH P-256 + фраза-пароль на
-- устройство) — БОЛЬШЕ НЕ ИСПОЛЬЗУЕТСЯ приложением. Колонка и таблица
-- оставлены как есть (ничего не удаляем из чужих баз), но новый код их
-- не читает и не пишет. Смотри conversation_keys ниже — это то, что
-- реально используется сейчас.
alter table public.profiles add column if not exists public_key text;

create table if not exists public.profile_keys (
    id uuid primary key references public.profiles(id) on delete cascade,
    encrypted_private_key text not null,
    key_salt text not null,
    key_wrap_iv text not null,
    key_kdf_iterations integer not null,
    updated_at timestamptz not null default now()
);
alter table public.profile_keys enable row level security;
drop policy if exists profile_keys_select on public.profile_keys;
create policy profile_keys_select on public.profile_keys for select using (auth.uid() = id);
drop policy if exists profile_keys_insert on public.profile_keys;
create policy profile_keys_insert on public.profile_keys for insert with check (auth.uid() = id);
drop policy if exists profile_keys_update on public.profile_keys;
create policy profile_keys_update on public.profile_keys for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------
-- CONVERSATION KEYS — текущая схема шифрования сообщений.
-- ------------------------------------------------------------
-- Раньше ключ шифрования переписки собирался на КАЖДОМ устройстве заново
-- из приватного ключа аккаунта, который был заперт отдельной фразой-
-- паролем и жил только в IndexedDB конкретного устройства. Если фраза-
-- пароль терялась или сбрасывалась на одном устройстве, все остальные
-- устройства (и оба собеседника) переставали совпадать по ключу —
-- сообщения переставали расшифровываться, иногда навсегда.
--
-- Теперь ключ переписки — один случайный AES-256 ключ на пару
-- собеседников, который лежит в базе один раз и отдаётся любому
-- залогиненному устройству любого из двоих через RLS — так же, как это
-- устроено в большинстве соцсетей: шифрование при хранении и передаче
-- есть, но оно не завязано на секрет, который может отсутствовать на
-- конкретном устройстве. Из-за этого Supabase технически МОЖЕТ прочитать
-- ключ (в отличие от старой схемы) — это осознанный компромисс в пользу
-- того, чтобы переписка никогда не "залипала" нерасшифровываемой.
create table if not exists public.conversation_keys (
    user1 uuid not null references public.profiles(id) on delete cascade,
    user2 uuid not null references public.profiles(id) on delete cascade,
    encryption_key text not null,
    created_at timestamptz not null default now(),
    primary key (user1, user2),
    constraint conversation_keys_ordered check (user1 < user2)
);
alter table public.conversation_keys enable row level security;
drop policy if exists conversation_keys_select on public.conversation_keys;
create policy conversation_keys_select on public.conversation_keys for select
using (auth.uid() = user1 or auth.uid() = user2);
drop policy if exists conversation_keys_insert on public.conversation_keys;
create policy conversation_keys_insert on public.conversation_keys for insert
with check (auth.uid() = user1 or auth.uid() = user2);

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

-- Adds image to installs that already had the messages table without it.
-- Photos are sent the same way post images are: resized client-side and
-- stored as a data URL, so no Storage bucket/policy is needed for them.
alter table public.messages add column if not exists image text not null default '';

-- E2E-шифрование: text/image хранят base64 AES-GCM шифротекст, а не
-- открытый текст, когда encrypted = true. iv/img_iv — base64 nonce для
-- расшифровки text/image соответственно. Сервер (и любой, кто заглянет
-- в базу напрямую) видит только шифротекст.
alter table public.messages add column if not exists encrypted boolean not null default false;
alter table public.messages add column if not exists iv text not null default '';
alter table public.messages add column if not exists img_iv text not null default '';

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
-- PRESENCE / NOW-PLAYING columns used by js/app.js but missing
-- from earlier versions of this file — safe to add if already there.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles add column if not exists current_track text not null default '';
alter table public.profiles add column if not exists current_artist text not null default '';

-- ------------------------------------------------------------
-- MUSIC SAVES — "add someone else's track to my music" (➕ button).
-- Also used by js/app.js but was missing from this file.
-- ------------------------------------------------------------
create table if not exists public.music_saves (
    music_id text not null references public.music(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (music_id, user_id)
);

-- ------------------------------------------------------------
-- ADMIN / MODERATION
-- role: 'user' | 'admin'. banned: blocks login and new posts/
-- comments/tracks/messages. ban_reason is shown to the admin
-- team and can be shown to the banned user.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'user' check (role in ('user','admin'));
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text not null default '';

-- security definer so these can be read inside RLS policies without
-- recursively re-triggering RLS on profiles.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_banned()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce((select banned from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_banned() to authenticated;

-- Stops a non-admin from granting themselves (or anyone) admin, or
-- un-banning themselves, by editing their own profile row — no matter
-- which update policy let the row through, role/banned/ban_reason only
-- ever actually change when the person running the update is an admin.
create or replace function public.protect_profile_role_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- auth.uid() is only set for requests coming through the app (a
    -- logged-in user). Requests run directly in the SQL Editor, or with
    -- the service_role key, have no auth.uid() at all — that's already
    -- the top of the trust chain (full database credentials), so this
    -- guard only needs to stop a logged-in *app* user from editing their
    -- own role/banned columns unless they're already an admin.
    if auth.uid() is not null and not public.is_admin() then
        new.role := old.role;
        new.banned := old.banned;
        new.ban_reason := old.ban_reason;
    end if;
    return new;
end;
$$;

drop trigger if exists protect_profile_role_columns_trg on public.profiles;
create trigger protect_profile_role_columns_trg
before update on public.profiles
for each row execute function public.protect_profile_role_columns();

-- ------------------------------------------------------------
-- REPORTS (жалобы) — on posts, comments, and profiles.
-- target_type/target_id point at the reported thing itself; target_user_id
-- is always the author behind it (for a profile report, that's just the
-- profile owner) so moderation can ban/unban straight from a report
-- without having to re-derive who it was against, even after the
-- underlying post/comment gets deleted.
-- ------------------------------------------------------------
create table if not exists public.reports (
    id text primary key,
    reporter_id uuid not null references public.profiles(id) on delete cascade,
    target_type text not null check (target_type in ('post','comment','profile')),
    target_id text not null,
    target_user_id uuid not null references public.profiles(id) on delete cascade,
    reason text not null default '',
    status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid references public.profiles(id) on delete set null,
    constraint reports_not_self check (reporter_id <> target_user_id)
);

-- Stops someone from spamming the same report over and over — one open
-- (pending) report per person per target is enough; they can still submit
-- again later if it gets dismissed.
create unique index if not exists reports_pending_unique
on public.reports (reporter_id, target_type, target_id)
where status = 'pending';

create index if not exists reports_status_idx on public.reports(status, created_at desc);

alter table public.reports enable row level security;
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select
using (auth.uid() = reporter_id or public.is_admin());
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert
with check (auth.uid() = reporter_id and not public.is_banned());
drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports for update
using (public.is_admin())
with check (public.is_admin());

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
create index if not exists music_saves_user_id_idx on public.music_saves(user_id);

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
create policy profiles_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- Lets an admin update ANY profile row (to ban/unban or grant/revoke
-- admin). The protect_profile_role_columns trigger above still makes
-- sure only an actual admin's update can move role/banned/ban_reason,
-- whichever of these two policies is the one that let the row through.
 drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
using (public.is_admin())
with check (public.is_admin());

-- Posts
 drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
 drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (auth.uid() = author_id and not public.is_banned());
 drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (auth.uid() = author_id or public.is_admin());

-- Comments
 drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (true);
 drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check (auth.uid() = author_id and not public.is_banned());
 drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (auth.uid() = author_id or public.is_admin());

-- Post likes
 drop policy if exists post_likes_select on public.post_likes;
create policy post_likes_select on public.post_likes for select using (true);
 drop policy if exists post_likes_insert on public.post_likes;
create policy post_likes_insert on public.post_likes for insert with check (auth.uid() = user_id);
 drop policy if exists post_likes_delete on public.post_likes;
create policy post_likes_delete on public.post_likes for delete using (auth.uid() = user_id);

-- Comment likes
 drop policy if exists comment_likes_select on public.comment_likes;
create policy comment_likes_select on public.comment_likes for select using (true);
 drop policy if exists comment_likes_insert on public.comment_likes;
create policy comment_likes_insert on public.comment_likes for insert with check (auth.uid() = user_id);
 drop policy if exists comment_likes_delete on public.comment_likes;
create policy comment_likes_delete on public.comment_likes for delete using (auth.uid() = user_id);

-- Friendships
 drop policy if exists friendships_select on public.friendships;
-- Public read: a confirmed friendship (both sides already accepted) is
-- shown on profile pages to ANY visitor, same as posts/profiles — so it
-- has to be selectable by everyone, not just the two people in it.
-- (Pending requests are a separate table, friend_requests, which stays
-- restricted to the two people involved — see below.)
create policy friendships_select on public.friendships for select using (true);
 drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships for insert with check (auth.uid() = user1 or auth.uid() = user2);
 drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships for delete using (auth.uid() = user1 or auth.uid() = user2);

-- Messages
 drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (auth.uid() = sender_id or auth.uid() = receiver_id);
 drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (auth.uid() = sender_id and not public.is_banned());
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
with check (auth.uid() = from_user);
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
create policy music_insert on public.music for insert with check (auth.uid() = author_id and not public.is_banned());
 drop policy if exists music_update on public.music;
create policy music_update on public.music for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
 drop policy if exists music_delete on public.music;
create policy music_delete on public.music for delete using (auth.uid() = author_id or public.is_admin());

-- Music saves ("add to my music" ➕ button)
 drop policy if exists music_saves_select on public.music_saves;
create policy music_saves_select on public.music_saves for select using (true);
 drop policy if exists music_saves_insert on public.music_saves;
create policy music_saves_insert on public.music_saves for insert with check (auth.uid() = user_id and not public.is_banned());
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
    -- Public keys (profiles.public_key) previously only ever loaded once at
    -- page load, with nothing to refresh them afterwards. If a partner sets
    -- up or resets their E2E key mid-session, everyone already chatting with
    -- them would silently keep encrypting/decrypting against the old key.
    -- Live updates on profiles let the client pick up a new public_key the
    -- moment it changes, instead of only on the next full reload.
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
        alter publication supabase_realtime add table public.profiles;
    end if;
    -- Lets an admin's moderation queue (on their own profile page) pick up
    -- a new report the moment it's filed, without needing a reload.
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'
    ) then
        alter publication supabase_realtime add table public.reports;
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
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- ============================================================
-- ONE-TIME: make yourself the first admin.
-- Nobody is an admin by default. After running the rest of this
-- file, replace 'your_username' below with your bubbles username,
-- select just this one line, and run it by itself once. After
-- that, grant/revoke admin for anyone else from the app's own
-- 🛡️ Админ page — you won't need to touch SQL again.
-- ============================================================
-- update public.profiles set role = 'admin' where username = 'your_username';
