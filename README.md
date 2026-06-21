# Zaaduna

A small Telegram bot that posts a daily
shared wird to one channel (morning and evening azkar, Friday sunan, a
daily reflection on أخلاق المسلم and the Prophet's ﷺ character, pre-sleep
dhikr, fasting reminders) and ends each night with an honest, anonymous
self-check.

The night poll is the heart of it. After Isha, the bot lists the day's
deeds and asks you to tick the ones you actually did. The vote is
**anonymous and multiple-answer**, so Telegram tallies the answers and
shows the channel the percentages, but nobody, not even this bot, ever
learns who voted for what. You get the lift of a community ("most of us
kept our azkar today") without the riya, and the bot keeps no database
of who did what.

## How it works (1-minute mental model)

1. `src/schedules.ts` is a plain list. Each item says: a cron time, and
   what to post (`kind: 'message'` with text, or `kind: 'poll'`).
2. At boot, `scheduler.ts` registers every item with node-cron.
3. When a time fires, it sends the message or poll to the channel.

No database. To change anything you edit a file and restart the bot.
That simplicity is on purpose: fewer moving parts means it keeps running
for years untouched.

## Project structure

```
src/
  index.ts        Entry point: config -> state -> bot -> scheduler -> health
  config.ts       Reads env vars (BOT_TOKEN, CHANNEL_CHAT_ID, ...)
  schedules.ts    THE FILE YOU EDIT MOST: the list of what/when
  types.ts        ScheduleDef + PollSpec types
  scheduler.ts    Registers schedules with cron, runs them, cleans up old posts
  bot.ts          Grammy setup: /start + admin commands
  content/        The Arabic texts + polls + welcome + akhlaq/adab libraries + quiz + cards
  lib/            hijri (no-fast days) + fileCache (card file_id cache)
scripts/
  send-test.ts    Dev tool: post every schedule once to preview it
  post-welcome.ts Dev tool: post or edit the pinned welcome message
docs/DEPLOY.md    How to deploy
docs/GUIDE.md     How the project works + how to make changes (start here)
```

The shared plumbing (logger, env, the random/fixed content pickers, the
plain-text/poll send wrappers, the cron runner, the `/health` server, and
the small JSON state file) lives in the `telegram-broadcast-kit`
dependency, reused across several bots. This repo keeps only what is
zaaduna-specific: the schedule list, the Arabic content, and the dispatch
glue in `scheduler.ts`.

## What it posts (times assume Africa/Cairo, the .env.example default)

| Name                | When            | What                                                      |
| ------------------- | --------------- | --------------------------------------------------------- |
| `morning_azkar`     | every day 05:30  | أذكار الصباح (+ بطاقة فاتحة/داكنة بالتناوب اليومي)        |
| `morning_adab`      | every day 05:31  | وقفة في السُّنن والآداب وأخلاق القلب (تتناوب يوميًّا)     |
| `friday_sunnah`     | Friday 05:32     | سنن الجمعة: طهارة وزينة، تبكير، الكهف، الصلاة على النبي ﷺ |
| `akhlaq_reminder`   | every day 16:58  | وقفة في أخلاق المسلم وهَدْي النبي ﷺ (تتناوب يوميًّا)      |
| `evening_azkar`     | every day 17:00  | أذكار المساء                                              |
| `friday_quiz`       | Friday 16:59     | Anonymous situational-adab **quiz** (موقف + best response, weekly)                 |
| `fasting_reminder`  | Sun & Wed 21:40  | تذكير صيام الإثنين/الخميس (الليلة التي قبلها)             |
| `pre_sleep`         | every day 21:43  | سورة المُلك + أذكار النوم + نيّة قيام الليل               |
| `night_review_poll` | every other 21:45 | Anonymous self-review **poll** (worship core + rotating أخلاق & بِرّ slots; Mon/Thu add صيام) |

Both fasting touchpoints are **Hijri-aware**: the Mon/Thu reminder and
the poll's «صيام» option are automatically withheld on days voluntary
fasting is forbidden — the two Eids and أيام التشريق — read from the Umm
al-Qura calendar in `TZ_NAME`. عرفة is never withheld. See
`src/lib/hijri.ts`.

Posts are deliberately grouped into one tight window so they arrive
together as a single "session" instead of scattered buzzes. What makes
people mute a channel is the number of separate interruption moments,
not the message count. So within each session only the anchor post makes
a sound; the posts co-scheduled a minute later are sent **silently**
(Telegram's `disable_notification`) and still appear in the channel,
they just do not buzz. The result is **exactly 3 notification moments a
day**:

1. A morning one — the azkar rings; the morning adab/sunnah reading (and,
   on Friday, the Surah Al-Kahf reminder) rides in silently right after.
2. A late-afternoon one — the akhlaq reflection arrives silently first
   (and, on Friday, the weekly situational-adab quiz), then the evening
   azkar rings just below it.
3. A bedtime one — the fasting reminder (Sunday and Wednesday) and the
   pre-sleep reminder arrive silently, then the poll rings.

The poll fires last on purpose and is the audible bedtime post: its last
option is «سورة المُلك وأذكار النوم», so a member who sees the gap in
their checklist scrolls up to the (silent) pre-sleep message above it and
acts on the dhikr there. The poll is a self-review nudge toward the
azkar, not a competitor.

Which posts ride in silently lives in one place: the `silent: true` flag
on those entries in `src/schedules.ts`.

## ⚠️ Before going live: have the content reviewed

The Arabic texts in `src/content/` were verified against their sources
(Bukhari, Muslim, the Sunan with gradings, and the canonical Hisn
al-Muslim) and each file lists its takhreej. Still, a bot whose whole
purpose is reward must not risk misattributing words to the Prophet ﷺ.
**Have a trusted طالب علم read `src/content/*.ts` once.** That single
review is the most important step in the project: it locks the benefit
and removes the risk.

## Quick start (local development)

```bash
pnpm install

cp .env.example .env
# Edit .env and set at least:
#   BOT_TOKEN          from @BotFather
#   CHANNEL_CHAT_ID    numeric -100... (see .env.example for two easy
#                      ways to find it) or @yourchannel
# Optional:
#   CHANNEL_PUBLIC_URL https://t.me/yourchannel  (tap-through link in /start)
#   ADMIN_TELEGRAM_ID  your numeric Telegram id (enables admin commands)
#   TZ_NAME            timezone for the cron times; .env.example uses
#                      Africa/Cairo (code falls back to UTC if unset)

pnpm dev
```

The bot must be added to your channel as an admin with the **"Post
messages"** permission, or every post (and the poll) will fail with 403.

## Previewing the messages without waiting (dev)

You usually do not want to wait until the night cluster to see the
poll. Run the dev sender to post **everything once, right now**, then
look at it in the channel:

```bash
pnpm send-test
```

- Needs the same `.env` (BOT_TOKEN + CHANNEL_CHAT_ID). It does not
  require `ADMIN_TELEGRAM_ID` to be set, unlike `/admin_run`.
- Runs a quick preflight check first (one Telegram API call, no
  posting). If your token or channel id is wrong, it exits with one
  clean error instead of spamming several failed sends.
- Starts each session with a short Arabic banner so anyone reading
  the channel knows the messages below it are dev previews, not real
  scheduled posts. The banner is intentionally not auto-cleaned, so
  each test session leaves its own marker in the scrollback. Delete
  old banners by hand when you are done reviewing.
- For the schedule posts themselves it reuses the exact production
  send code, so what you see is what subscribers will see. Re-running
  it auto-cleans the previous run's azkar/poll posts before posting
  fresh ones (same delete-previous logic the real scheduler uses), so
  no manual cleanup for those, as long as you re-run from the same
  machine. The pointer file is local: a test post sent from your
  laptop will not be cleaned up by prod's later real cron fire, and
  vice versa.

## Editing what it posts

Everything lives in source. No database; restart (or redeploy) to apply.

- **Message wording:** edit the matching file in `src/content/`.
- **The azkar cards:** the three azkar attach a card image that alternates
  between variant 1 and variant 2 by day (all three share the day's variant).
  To change the art, replace the PNGs in `assets/cards/` keeping the
  `{morning-azkar,evening-azkar,pre-sleep-azkar}-{1,2}.png` names. They are
  sent as a silent photo above the azkar text. See `src/content/cards.ts`.
  Each card image is uploaded to Telegram only once, then resent by its
  `file_id` so it loads instantly and is never re-uploaded; swapping a PNG
  is detected automatically (the cache is keyed by the file content). See
  `src/lib/fileCache.ts`.
- **The two daily reading libraries:** the morning reading is
  `adabReminders` in `src/content/adab.ts` (sunan/آداب/heart-akhlaq — what
  to DO today); the evening reading is `akhlaqReminders` in
  `src/content/akhlaq.ts` (character/shamail — who to BE). Each shows one
  short post a day by deterministic rotation; the same date always shows the
  same one, the whole list is shown before any repeat, and nothing is ever
  deleted, so each builds a browsable, shareable archive. Every saying
  attributed to the Prophet ﷺ must be sahih or hasan, with its source in the
  comment above it. Each file header explains the rules and how the list size
  affects how soon a post repeats; read it before adding/removing items.
- **The weekly quiz:** edit the `adabQuizzes` list in `src/content/quiz.ts`
  (a موقف + 2–4 options, one correct, plus a ≤200-char explanation shown
  after voting). Anonymous, fires every Friday, rotates weekly. Use ONLY
  agreed-upon adab grounded in explicit nass — never contested fiqh — and
  keep the tone gentle (see the file header).
- **The night poll:** edit `src/content/poll.ts` (the question and its
  options). Keep it anonymous and multiple-answer, that is the whole
  point. The list is built at fire time: a fixed worship core (8) + one
  rotating أخلاق check + one rotating بِرّ (حقوق العباد) deed every night, so
  topics vary across days while the core stays; Monday/Thursday nights add a
  «صيام الاثنين/الخميس» option (withheld on Eid / أيام التشريق — see
  `src/lib/hijri.ts`). The question is framed for today *and* tomorrow. Telegram
  now allows up to 12 options per poll.
- **Times or new entries:** edit `src/schedules.ts`. Each entry is one
  cron rule plus `kind: 'message'` (with `content`) or `kind: 'poll'`
  (with `poll`).

Cron is read in `TZ_NAME`. Day-of-week: `0`/`7`=Sun, `1`=Mon, `5`=Fri.
Keep new times at **02:00 or later**: once a year Cairo's clock jumps
00:00 -> 01:00 (DST) and node-cron silently drops jobs in that gap.

## Commands (in a Telegram DM to the bot)

| Command             | Who    | What it does                                  |
| ------------------- | ------ | --------------------------------------------- |
| `/start`            | anyone | Short "this is channel-only" reply (AR/EN)    |
| `/admin_health`     | admin  | Uptime, channel, list of registered schedules |
| `/admin_run <name>` | admin  | Fire one schedule **now** (real end-to-end)   |

Example: `/admin_run night_review_poll` posts the poll to the channel
immediately.

**Who is "admin"?** Only the Telegram user whose numeric id equals
`ADMIN_TELEGRAM_ID` in `.env`, and only in a private chat with the bot.
The same command sent in a group is ignored, so the channel id and
schedule internals never leak there. To everyone else the admin
commands are completely silent (they do not reveal that they exist). If
`/admin_run` cannot post, it replies with the reason. The most common
one is that the bot is not a channel admin with "Post messages".

- Find your numeric id by messaging [@userinfobot](https://t.me/userinfobot)
  on Telegram; it replies with your `Id`.
- Put it in `.env`: `ADMIN_TELEGRAM_ID="123456789"`.
- Leave it empty to disable all admin commands (a safe set-and-forget
  deploy).

## npm scripts

```bash
pnpm dev             # run in watch mode (auto-restart on save)
pnpm send-test       # dev: post every message + the poll once, then exit
pnpm post-welcome    # dev: post or edit-in-place the pinned welcome message
pnpm build           # type-check and compile to dist/
pnpm start           # run the compiled bot (production)
pnpm test            # run the test suite (fast, no network or database)
pnpm typecheck       # type-check only, no output
pnpm format          # auto-format with Prettier
pnpm format:check    # verify formatting (used before commits)
```

## Channel welcome (pinned intro)

The welcome message new joiners see lives in `src/content/welcome.ts`.
It is **not** posted by the bot's cron loop — you push it manually:

```bash
pnpm post-welcome                # first time: posts new, prints message_id
pnpm post-welcome <message_id>   # later: edits in place; pin + notification stay
```

After the first post, pin the message in the channel by hand
(message → ⋮ → Pin). Remember the printed id so future edits can use
the second form and not re-fire a notification or break the pin.

## Deploying

See `docs/DEPLOY.md` for the full notes (env vars, channel admin rights,
state file). It runs in production as a Docker container on a small VPS,
managed by Docker Compose — that section is the primary path. Fly.io is
kept as a fallback with its own walkthrough in `FLYIO.md`. Every push to
`main` auto-deploys to the server via `.github/workflows/deploy.yml`
(once the `SERVER_IP` and `SSH_KEY` secrets are set).

In short: a host that keeps the process alive (a VPS with Docker, or any
PaaS), the env vars set, and the bot added to the channel as an admin
with **both** "Post messages" and "Delete messages" granted.

## What this is NOT

No per-user tracking, no streaks, no personal history. Those would need
a database and a subscriber bot, and would re-introduce the showing-off
(riya) problem the anonymous poll avoids. This bot stays a simple,
long-lived channel poster on purpose.

## License

0BSD — free to use, copy, modify, and distribute for any purpose, with no
attribution required. See `LICENSE`.
