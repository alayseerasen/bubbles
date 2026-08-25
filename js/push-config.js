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
    "BLAKjyFnnPhZHPDPPB-2bm_cSjhmTD3u6n36hIe4qr-79jhjfN1uaYTMArqHLu4yrL2-_aEuGyeN_f6SOqmaoDw";
