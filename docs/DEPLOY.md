# Deployment

The bot is a long-polling Grammy process. It needs:

1. Node.js 20+ on a host that keeps long-lived processes alive.
2. A Telegram channel the bot is an admin of, with **both**:
   - "Post messages" — required for the daily messages and the poll.
   - "Delete messages" — required for the replace-on-next-fire cleanup
     of repeating azkar. Without it the bot still posts; it just can't
     clean up, so the channel slowly accumulates dupes.
3. The environment variables below.
4. A writable `DATA_DIR` for its two tiny JSON files (default `./data`).
   Most hosts give you this for free.

## Environment variables (.env at repo root)

| Variable             | Required | Notes                                                                   |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `BOT_TOKEN`          | yes      | From @BotFather                                                         |
| `CHANNEL_CHAT_ID`    | yes      | Numeric `-100...` (recommended) or `@channel`. Not a URL.               |
| `CHANNEL_PUBLIC_URL` | no       | Public link shown only in `/start`. Decoupled from sending.             |
| `ADMIN_TELEGRAM_ID`  | no       | Enables /admin\_\* commands. Empty = no admin commands work.            |
| `TZ_NAME`            | no       | Cron timezone. Code default UTC; `.env.example` = Africa/Cairo          |
| `DATA_DIR`           | no       | Dir for the bot's two JSON files (state + card cache). Default `./data` |
| `NODE_ENV`           | no       | `production` for hosted deploys                                         |
| `PORT`               | no       | /health server port (default 8080)                                      |

`CHANNEL_CHAT_ID` should be the numeric id in production: it never
changes, so posting can never break if the channel username is renamed.
`CHANNEL_PUBLIC_URL` is purely cosmetic (the tap-through link in the
`/start` reply) and is safe to leave empty for a private channel.

## Adding the bot to your channel

1. Open Channel settings, then Administrators, then Add admin.
2. Search for your bot username.
3. Grant **"Post messages"** AND **"Delete messages"**. Post is for the
   daily reminders + poll; Delete is for the replace-on-next-fire
   cleanup that keeps the channel from accumulating dupes of repeating
   azkar. With Delete granted, the 48h `deleteMessage` cap does not
   apply, so even the weekly `friday_sunnah` post can be cleaned up
   when the next one fires.

## Finding `CHANNEL_CHAT_ID`

Use the numeric `-100...` id. It works for both public and private
channels and survives any username rename. Two reliable ways to get it
without any third-party bot:

1. **Telegram Web.** Open https://web.telegram.org/k/ and click your
   channel. The URL ends with something like `#-3723418314`. Insert
   `100` right after the minus sign, so `-3723418314` becomes
   `-1003723418314`. That is your `CHANNEL_CHAT_ID`.

2. **getUpdates via your own bot.** Add the bot to the channel as
   admin, post any message there by hand, then open
   `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in a
   browser. Look for a `channel_post` entry; the `"chat":{"id":...}`
   field has the exact id to paste.

A public `@handle` is also accepted (`CHANNEL_CHAT_ID="@mychannel"`),
but the numeric id is the safer production choice.

Do NOT put an invite-link slug like `+oPN5XjvvARNjYzc0` here. Telegram
rejects it as "chat not found". Invite links belong in
`CHANNEL_PUBLIC_URL`, not here.

For the tap-through link in `/start`, set `CHANNEL_PUBLIC_URL` to the
share link. For a public channel that is `https://t.me/yourchannel`;
for a private channel use its invite link, e.g.
`https://t.me/+oPN5XjvvARNjYzc0`. Leave it empty to show no link.

## Run locally

```bash
pnpm install
cp .env.example .env
# Edit .env
pnpm dev
```

Grant yourself admin (`ADMIN_TELEGRAM_ID`), then fire any schedule by
hand to confirm the channel receives it, e.g.:

```
/admin_run morning_azkar
/admin_run night_review_poll
```

## Docker Compose on a VPS (primary deploy)

This is how the bot runs in production: a Docker container on a small
VPS, alongside other bots, managed by one Docker Compose file. Works on
any provider (Hetzner, etc.); nothing here is provider-specific.

On the server (with Docker + the `compose` plugin installed), clone the
repo and create its `.env`:

```bash
mkdir -p /opt/bots/telegram
git clone https://github.com/edriso/zaaduna.git /opt/bots/telegram/zaaduna
cp /opt/bots/telegram/zaaduna/.env.example /opt/bots/telegram/zaaduna/.env
# edit that .env: BOT_TOKEN, CHANNEL_CHAT_ID, TZ_NAME, NODE_ENV=production
```

A single `docker-compose.yml` at `/opt/bots` runs every bot, one service
each:

```yaml
services:
  zaaduna:
    build: ./telegram/zaaduna
    env_file: ./telegram/zaaduna/.env
    restart: unless-stopped
    volumes:
      - zaaduna-data:/app/data

volumes:
  zaaduna-data:
```

Bring it up (the same command rebuilds after a code change):

```bash
cd /opt/bots
docker compose up -d --build zaaduna
docker compose logs -f zaaduna
```

Notes:

- The image runs as a non-root user, so state lives in a **named volume**
  (`zaaduna-data`), not a bind mount — the named volume inherits the
  right ownership automatically and survives restarts and redeploys.
- `restart: unless-stopped` brings the bot back after a reboot or crash.
- Only **one** process may long-poll a given bot token. When migrating
  from another host, stop the old one first or Telegram returns
  `409 Conflict`.
- Redeploy by hand with `git pull` in the bot's folder, then
  `docker compose up -d --build zaaduna`. For push-to-deploy, see the
  GitHub Action in `.github/workflows/deploy.yml`.

## Fly.io (fallback)

Fly.io is no longer the primary host (see the Docker Compose section
above), but the `Dockerfile`, `fly.toml`, and the full **`FLYIO.md`**
walkthrough are kept in the repo so you can return to it. The short
version:

```bash
fly apps create zaaduna
fly secrets set BOT_TOKEN=... CHANNEL_CHAT_ID=-100... TZ_NAME=Africa/Cairo
fly deploy
fly scale count 1 -a zaaduna   # pin to one machine (see FLYIO.md)
```

## Railway

1. Deploy from GitHub repo.
2. Build: `pnpm install && pnpm build`
3. Start: `pnpm start`
4. Set the env vars listed above. Railway provides `PORT` automatically.

## Welcome message (one-time setup)

The pinned welcome new joiners see is single-sourced in
`src/content/welcome.ts` and pushed manually:

```bash
pnpm post-welcome                # first time: posts new, prints message_id
pnpm post-welcome <message_id>   # later: edits in place (pin stays, no ping)
```

After the first post, pin the message in Telegram by hand (channel →
message → ⋮ → Pin). Note the printed id; use it for every future edit
so the pin and the notification etiquette are preserved.

The welcome is intentionally outside the cron loop: it is read once and
pinned, not re-posted daily, and is therefore never tracked or deleted
by the ring-buffer cleanup that handles the daily azkar.

## Editing schedules

All rules live in `src/schedules.ts`. Each entry is `{ name, kind, cron,
... }` where `kind` is `'message'` (with `content`) or `'poll'` (with
`poll`). Add, remove, or edit entries and redeploy.

To change only the wording, edit the files in `src/content/`. Message
content is a fixed string, or an array (one random element is picked
each time it fires). The poll lives in `src/content/poll.ts`.

## State file (`./data/last-message-ids.json`)

The bot writes two tiny JSON files in `DATA_DIR` (default `./data`): one
maps each message-schedule name to its last posted `message_id` so it can
delete the previous copy on the next fire, and one caches Telegram
`file_id` values so each card image is uploaded only once. Losing either
is not fatal — the bot just re-derives it (a few stale messages linger, or
each card is uploaded once more). On hosts with a persistent disk (VPS,
Docker volume) this survives restarts; on ephemeral hosts it degrades
gracefully. Point `DATA_DIR` at a mounted volume to keep both files.

## Logs

Every scheduled fire and every send writes a line to stdout. PaaS
platforms capture stdout. To check whether today's posts ran, search
the log for the schedule name, `Posted message to channel`, or
`Posted poll to channel`.

## Healthcheck

```
GET /health
```

Returns `200 { status: "ok", uptimeSeconds }` while the process is up.
