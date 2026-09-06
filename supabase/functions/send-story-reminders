# Напоминание про сторис — деплой

В отличие от `send-push/` (которая срабатывает по вебхуку сразу при
новой записи в базе), эта функция работает **по расписанию** — раз в
30 минут проверяет, у кого сторис вот-вот пропадёт, и никто её ещё не
видел.

## 1. Прогони `supabase.sql`

Там уже добавлена колонка `stories.reminder_sent`.

## 2. Создай Edge Function

Supabase Dashboard → **Edge Functions** → **Deploy a new function**.
- Имя: `send-story-reminders`
- Вставь код из `index.ts` (файл рядом с этим README) целиком.
- Deploy.

## 3. Секреты функции

Те же самые секреты, что уже заданы для `send-push` — заходишь в
настройки **этой** функции (`send-story-reminders`) → **Secrets** и
добавляешь ту же пару:

```
VAPID_PUBLIC_KEY=<тот же публичный ключ, что и у send-push>
VAPID_PRIVATE_KEY=<тот же приватный ключ, что и у send-push>
```

(Секреты в Supabase задаются отдельно на каждую функцию, даже если
значения одинаковые — просто скопируй те же значения сюда ещё раз.)

## 4. Расписание (Cron)

Dashboard → **Edge Functions** → `send-story-reminders` → вкладка
**Cron** (или **Schedules**, в зависимости от версии интерфейса) →
**Add a schedule**.

- Cron-выражение: `*/30 * * * *` (каждые 30 минут)
- Сохранить

Если такой вкладки нет в твоей версии Dashboard (более старые проекты
иногда без неё) — альтернативный способ через SQL Editor, вставь и
запусти один раз (замени `<project-ref>` и `<anon-или-service-key>` на
свои — их видно в Project Settings → API):

```sql
select cron.schedule(
  'send-story-reminders-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-story-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <anon-или-service-key>')
  );
  $$
);
```

(Это включает расширения `pg_cron` и `pg_net`, если ещё не включены —
Dashboard → Database → Extensions.)

## 5. Проверка

Быстрее всего — вручную создай тестовую сторис с `expires_at` в
ближайшие 2 часа (или подожди, пока настоящая подойдёт к этому окну),
убедись, что её никто не смотрел, и подожди до получаса — либо просто
вызови функцию руками через Dashboard → Edge Functions →
`send-story-reminders` → **Invoke** для мгновенной проверки, не дожидаясь
расписания.

Если не приходит — Logs той же функции покажет, что пошло не так
(чаще всего то же самое, что в `send-push`: несовпадающие секреты).
