/*
  BUBBLES — Push-уведомления, публичный ключ.

  Это VAPID public key — его можно спокойно оставить прямо в коде,
  как и Supabase anon key выше: он публичный по своей природе и нужен
  браузеру, чтобы подписаться на пуши от ИМЕННО этого сервера.
  Секретная половина (VAPID_PRIVATE_KEY) сюда НЕ идёт — она хранится
  только в Supabase Edge Function как секрет, см.
  supabase/functions/send-push/README.md.
*/
window.BUBBLES_VAPID_PUBLIC_KEY =
    "BD-vS9Hbpm2n-FEcAZXO_sggtDQehgfCn-qWIeuD4KNYbL_CH-iRgY4fZXKN7ddRHV55vbjlK6kKtoFmEYTy46c";
