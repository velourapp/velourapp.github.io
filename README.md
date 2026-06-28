# Velour — лендинг

Чистая статика: `index.html`, `privacy.html`, `style.css`, `lang.js`, `assets/`.
Без сборщика — GitHub Pages отдаёт файлы как есть.

## Перед публикацией — заполнить плейсхолдеры

Найди и замени по всем файлам (`index.html`, `privacy.html`):

- `{{TG_SUPPORT_URL}}` — ссылка на Телеграм-канал поддержки
- `{{CONTACT}}` — контакт для privacy policy (тот же ТГ или email)
- `{{DATE}}` — дата публикации (в `privacy.html`)
- `{{STORE_URL}}` — ссылка на расширение в Chrome Web Store (когда опубликуется)

Замени плейсхолдеры в `assets/` (`screenshot-panel.svg`, `screenshot-telegram.svg`,
`demo-placeholder.svg`) на реальные скриншоты/GIF/видео — просто положи файлы
с теми же именами (или поменяй пути в `index.html`).

## Публикация на GitHub Pages

1. Создай репозиторий **`velourapp.github.io`** на GitHub (имя репо должно
   точно совпадать с `<username-или-org>.github.io` — тогда сайт будет
   доступен прямо на `https://velourapp.github.io/`, без `/repo-name/` в пути).
2. Залей содержимое этой папки в корень репозитория и запушь в `main`:
   ```bash
   cd C:\tmp\AI_Fansly\landing
   git init
   git add .
   git commit -m "Velour landing"
   git branch -M main
   git remote add origin https://github.com/<org>/velourapp.github.io.git
   git push -u origin main
   ```
3. На GitHub: **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: **main** / **/(root)** → Save.
4. Через минуту-две сайт появится на `https://velourapp.github.io/`.
   Если используешь свой домен — впиши его в Settings → Pages → Custom domain
   (и добавь файл `CNAME` с этим доменом в корень репо).

## Локальная проверка

Можно просто открыть `index.html` в браузере (всё работает без сервера).
Для проверки относительных путей и `loading="lazy"` так же, как на хостинге,
удобнее поднять любой простой статический сервер, например:

```bash
cd C:\tmp\AI_Fansly\landing
python -m http.server 8080
```

и открыть `http://localhost:8080/`.
