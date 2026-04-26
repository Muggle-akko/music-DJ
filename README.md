# Awudio AI Music Player MVP

Nothing style personal AI radio. The first version is intentionally small:

- Static PWA frontend in `public/`.
- Zero-dependency Node server in `server.mjs`.
- `/api/chat` creates an AI DJ plan.
- `/api/music/search` calls a NeteaseCloudMusicApi-compatible service when configured.
- Local demo mode keeps the player usable without API keys.

## Start

```powershell
npm run dev
```

Open:

```text
http://localhost:4173
```

## DeepSeek

The app supports DeepSeek through its OpenAI-compatible Chat Completions API.

Set these in `.env`:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_new_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

`deepseek-v4-flash` is the default because the DJ planner needs fast structured JSON, not heavy reasoning. Use `deepseek-v4-pro` later if you want stronger planning.

Do not commit `.env`. It is ignored by `.gitignore`.

## NeteaseCloudMusicApi

Netease Cloud Music does not provide a stable public playback API for this use case. This MVP talks to a NeteaseCloudMusicApi-compatible service.

Fast local option:

```powershell
npx NeteaseCloudMusicApi@latest
```

Docker option:

```powershell
docker run -d -p 3000:3000 --name netease_cloud_music_api binaryify/netease_cloud_music_api
```

Then set:

```env
NCM_API_BASE=http://127.0.0.1:3000
```

The player currently uses these endpoints:

- `/search`
- `/song/url/v1`
- `/song/url`
- `/lyric`

Some tracks will not return a playable URL because of account, VIP, copyright, or region restrictions. The app should not try to bypass those restrictions.

## Cookie

Use your own account only.

Preferred flow after starting NeteaseCloudMusicApi:

1. Visit `http://127.0.0.1:3000/qrlogin.html` if your service exposes the bundled QR login page.
2. Scan the QR code with the NetEase Cloud Music app.
3. Copy the returned cookie from the page output.
4. Put it in `.env`:

```env
NCM_COOKIE=your_cookie_here
```

Manual browser method:

1. Log in to `music.163.com`.
2. Open browser DevTools.
3. Go to Application or Storage, then Cookies, then `https://music.163.com`.
4. Copy the cookie string for your own account and put it in `NCM_COOKIE`.

Keep the cookie private. It is effectively a login credential.

## API

- `POST /api/chat` - natural language DJ request.
- `GET /api/music/search?q=keyword` - search music.
- `POST /api/taste` - record like, dislike, and play history.
- `GET /api/now` - current playback state.
- `GET /api/plan/today` - placeholder daily station plan.
