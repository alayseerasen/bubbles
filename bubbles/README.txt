BUBBLES — Supabase version

СТРУКТУРА
index.html                 главная страница
css/style.css              текущий дизайн bubbles
js/supabase-config.js      URL + ключ проекта Supabase
js/supabase.js              создание Supabase client
js/app.js                   логика приложения
supabase.sql                таблицы, RLS и Storage bucket

ПОДКЛЮЧЕНИЕ
1. Открой Supabase -> SQL Editor.
2. Вставь весь supabase.sql и нажми Run.
3. Открой Project Settings -> API.
4. Скопируй Project URL и Publishable/Anon key.
5. В js/supabase-config.js замени:
   YOUR_PROJECT_REF
   YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
6. Загружай всю папку на хостинг.

РЕГИСТРАЦИЯ
Теперь используется Supabase Auth по почте + паролю.
Если в Authentication включено подтверждение email, после регистрации нужно подтвердить письмо.

МУЗЫКА
Музыка больше не хранится в IndexedDB браузера.
MP3 и обложки загружаются в Storage bucket "music".
При публикации вводятся:
- название трека
- имя артиста
- обложка
- MP3

После публикации трек сразу появляется во вкладке «Музыка».
Глобальный плеер остаётся доступен при навигации по сайту.
