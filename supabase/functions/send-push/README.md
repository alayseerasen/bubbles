# Push-уведомления — деплой

Это единственная часть push-уведомлений, которую нельзя сделать одним
запуском `supabase.sql`: серверная функция, которая реально шлёт пуш,
живёт в Supabase Edge Functions, и её нужно один раз задеплоить и
настроить руками через Supabase Dashboard (можно прямо с телефона в
браузере, CLI не нужен).

## 1. Прогони `supabase.sql`

Как обычно — там уже добавлена таблица `push_subscriptions`.

## 2. Создай Edge Function

Supabase Dashboard → **Edge Functions** → **Deploy a new function**.
- Имя: `send-push`
- Вставь код из `index.ts` (файл рядом с этим README) целиком.
- Deploy.

## 3. Задай секреты функции

Там же, в настройках функции `send-push` → **Secrets**, добавь:

```
VAPID_PUBLIC_KEY=BD-vS9Hbpm2n-FEcAZXO_sggtDQehgfCn-qWIeuD4KNYbL_CH-iRgY4fZXKN7ddRHV55vbjlK6kKtoFmEYTy46c
VAPID_PRIVATE_KEY=EHXNamxQhGf9rbakPHdd3dttnVWS5VPJCaDzQLq_50Q
```

(`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет в
Edge Functions сам, руками их задавать не нужно.)

⚠️ `VAPID_PRIVATE_KEY` — секрет, храни только здесь. Публичный ключ
уже лежит в `js/push-config.js` в самом проекте, это нормально, он
для того и публичный.

## 4. Подключи два Database Webhook

Dashboard → **Database** → **Webhooks** → **Create a new hook**, и так
дважды:

**Хук №1 — уведомления (лайки/комменты/заявки в друзья):**
- Table: `bubbles_notifications`
- Events: `Insert`
- Type: **Supabase Edge Functions**
- Edge Function: `send-push`

**Хук №2 — сообщения:**
- Table: `messages`
- Events: `Insert`
- Type: **Supabase Edge Functions**
- Edge Function: `send-push`

## 5. Проверка

Зайди в Bubbles с телефона, разреши уведомления, когда спросит
(при первом входе после обновления). Попроси кого-то лайкнуть твой
пост или написать сообщение, пока вкладка Bubbles закрыта или
телефон заблокирован — должно прилететь системное уведомление.

Если не приходит — Dashboard → Edge Functions → send-push → **Logs**
покажет, что пошло не так (чаще всего: забытый секрет или webhook не
на ту таблицу).

## Важно про iOS

На iPhone push-уведомления в браузере работают **только** если
Bubbles добавлен на домашний экран как приложение (через Safari →
«Поделиться» → «На экран Домой») — просто в открытой вкладке Safari
push не сработает, это ограничение самого iOS (начиная с iOS 16.4).
На Android — работает и в обычной вкладке Chrome, и как установленное
PWA.
