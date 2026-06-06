# Zaaduna (زادنا): Repo Guide

## What this is

A near-zero-state Telegram bot that posts daily Islamic reminders to one
channel and runs a nightly **anonymous** self-review poll. The poll is
anonymous + multiple-answer on purpose: Telegram aggregates the votes
and shows percentages to everyone, nobody (including this bot) learns
who voted. That delivers community motivation with no riya and no DB.

Repeating reminders (azkar) auto-replace each other — the channel keeps
one live copy per schedule, not a year of identical dupes. Polls and
any human-posted message (your welcome / pinned intro) are never
touched. See the "Replace-on-next-fire" design choice below.

## Folder layout

```
zaaduna/
├── src/
│   ├── index.ts        Entry point (config → state → bot → scheduler → health)
│   ├── config.ts       env: BOT_TOKEN, CHANNEL_CHAT_ID, CHANNEL_PUBLIC_URL, ...
│   ├── bot.ts          Grammy setup, /start + admin commands
│   ├── scheduler.ts    runSchedule() dispatch + ring-buffer (cron registry from the kit)
│   ├── schedules.ts    THE EDIT POINT: the schedule list + findSchedule
│   ├── types.ts        ScheduleDef union + PollSpec (no import cycle)
│   ├── content/        Arabic content modules + poll spec + welcome.ts + format.ts (azkar HTML) + akhlaq.ts (daily-rotation library)
│   └── lib/            hijri (Umm al-Qura no-fast days)
├── scripts/
│   ├── send-test.ts       Manual dev sender (not imported by the app)
│   └── post-welcome.ts    Manual welcome-message post/edit (not imported)
├── data/               Tiny pointer file (gitignored). Auto-created.
├── docs/DEPLOY.md      Host-agnostic deploy notes (env vars, admin rights)
├── FLYIO.md            Fly.io-specific walkthrough (setup, triage, rollback)
├── Dockerfile          Two-stage Node 22 alpine build (Fly.io + any container host)
├── .dockerignore       Files excluded from the Docker build context
├── fly.toml            Fly.io app config (no [http_service]; see FLYIO.md)
├── package.json
└── tsconfig.json
```

The generic plumbing — `logger`, `env`, `bidi`, `pickContent`, the JSON-pointer `state`,
`post`/`sendPoll`/`deleteMessage`, the cron `Scheduler`, and the `/health` server — comes from
**`telegram-broadcast-kit`** (pinned by tag in `package.json`, auto-bumped by Renovate). This bot
keeps only what is zaaduna-specific: the schedule table, content, the `runSchedule` ring-buffer
dispatch, and `lib/hijri.ts`. Mentions of `lib/post.ts` / `lib/state.ts` / `pickContent` below now
refer to those kit modules. To change shared code, edit the kit and ship a new tag — see its README.

## Tech stack

| Layer    | Choice                                                      |
| -------- | ----------------------------------------------------------- |
| Bot      | TypeScript, Grammy, node-cron, Node 20+                     |
| Storage  | none, except one tiny JSON pointer file (see "No database") |
| Packager | pnpm                                                        |

## Design choices

- **No database.** Config and content live in source: cron in
  `schedules.ts`, content in `content/`. Redeploy to change anything.
  This simplicity is a feature: fewer parts → it runs untouched for
  years. One deliberate carve-out: `src/lib/state.ts` keeps a tiny JSON
  pointer file (`{ scheduleName: messageIds[] }`, default
  `./data/last-message-ids.json`) so the replace / ring-buffer delete
  survives a restart. It is NOT state-as-truth — no schema, no queries;
  same conceptual weight as `.env`. Losing the file just means each
  schedule leaks a handful of stale messages until they age out of the
  ring buffer. The reader accepts the pre-ring-buffer single-number
  shape too, so old state files migrate transparently.
- **Ring-buffer cleanup (per-schedule `keepLast`).** Repeating posts
  would otherwise accumulate (a year of identical azkar; a year of
  identical-question polls) and bury the welcome / pinned intro for
  new joiners. So each schedule has an effective `keepLast`:
  - messages default to **1** → exactly one live copy (the old
    replace-on-next-fire rule, unchanged).
  - polls default to **0** → never tracked, never deleted.
  - `night_review_poll` overrides to **1** → same replace-on-next-fire
    rule as messages. Tonight's poll fires, last night's is deleted.
    One live poll in the channel at any time. Yesterday's tally goes
    with it — judged not worth the daily stack of identical-question
    polls. The N > 1 code path is still supported (see scheduler.ts)
    but unused in prod.

  Order is post-then-trim so the channel is never empty mid-cycle. Any
  message NOT posted via this code path (your welcome / pinned intro,
  other admins) is never tracked here, and therefore never deleted.
  See `scheduler.ts#runSchedule` + `lib/state.ts`.

- **Daily-rotation evergreen library (`selection: 'daily'` + `keepLast:
0`).** Most posts are fixed or repeating, but `akhlaq_reminder` is
  different: it walks a growing pool of unique vignettes (أخلاق المسلم،
  هَدْي النبي ﷺ، الصحابة، حِكَم جامعة) one item a day. Two flags make
  this work together:
  - `selection: 'daily'` (`types.ts` → `MessageSchedule`) picks by
    day-of-year via the kit's `pickForDay`, computed in `config.timezone`
    (never `Date.getDay()`): the same calendar day always shows the same
    item, two consecutive days never repeat, and the whole pool is shown
    before any repeat. It is **stateless**, so it is restart-safe by
    construction — no pointer file needed, unlike the ring buffer.
  - `keepLast: 0` opts the schedule OUT of the ring buffer, so nothing is
    ever deleted. The channel grows a browsable, shareable archive instead
    of throwing yesterday's reflection away (the opposite of the azkar,
    which keep one live copy). `scheduler.ts#sendForKind` branches on
    `selection`; `content/akhlaq.ts` holds the pool; a content test pins
    the no-consecutive-repeat property over a full year.

- **One ping per session (`silent` riders).** What makes people mute a
  channel is the number of separate notification moments, not the message
  count. So each session has one anchor that rings and the rest ride in
  with `silent: true` (Telegram `disable_notification`): they still appear
  in the channel, they just do not buzz. Anchors (ring): `morning_azkar`,
  `evening_azkar`, `night_review_poll`. Riders (silent): `friday_sunnah`
  (after the morning azkar), `akhlaq_reminder` (before the evening azkar),
  `fasting_reminder` and `pre_sleep` (before the night poll). Net: exactly
  3 pings a day. The flag lives on the schedule entry (`types.ts` →
  `BaseSchedule.silent`), the scheduler passes it to `lib/post.ts`, and a
  test pins the anchor/rider split.

- **Anonymous poll, not per-user tracking.** Streaks/personal history
  would need a DB and a subscriber bot, and re-introduce showing-off
  (riya). The anonymous poll keeps motivation without either. Do not
  "upgrade" this without a deliberate decision.
- **`ScheduleDef` is a discriminated union** (`kind: 'message' |
'poll'`). `scheduler.ts#runSchedule` switches on `kind`. Adding a
  schedule needs no other code change.
- **`PollSchedule.poll` may be a factory.** `() => PollSpec` is rebuilt
  per fire, so the night review can vary by day-of-week (Mon/Thu nights
  add a «صيام الاثنين/الخميس» option — see `content/poll.ts`). One
  schedule + one cron + one state key — replace-on-next-fire stays
  intact across day-types. Day-of-week is computed in `config.timezone`
  via `Intl.DateTimeFormat`, never `Date.getDay()` (which would read
  the host TZ).
- **No-fast days are skipped (Hijri-aware, `lib/hijri.ts`).** Voluntary
  fasting is forbidden on عيد الفطر، عيد الأضحى، وأيّام التشريق. The
  Mon/Thu nudge runs on a Gregorian cron with no Hijri sense, so it once
  told people to fast on a Tashreeq day. Fix: `noFastReason` reads the
  **Umm al-Qura** calendar baked into Node's ICU
  (`-u-ca-islamic-umalqura`) in `config.timezone` (same discipline as
  `weekdayInTz`). `fasting_reminder` carries a generic `skipIf` guard
  (see `types.ts`) that suppresses the post when **tomorrow** is a
  no-fast day; `buildNightReviewPoll` drops the «صيام» option when
  **today** is one (the poll reviews the day ending — different day
  reference). The window is **narrow, asymmetric, Arafah-aware**: شوّال 1
  only (no cushion — شوّال 2+ is the ستّ من شوّال Sunnah); ذو الحجة 10–13
  plus a **+1 forward** cushion (day 14) for the late-sighting drift —
  but **never backward onto ذو الحجة 9 (عرفة)**, the most virtuous nafl
  fast. Umm al-Qura is calculated, so the pinned `welcome.ts` caveat (and
  the reader's own local Eid knowledge) is the backstop for the rare
  opposite drift — the reminder itself stays clean year-round, no
  per-fire disclaimer. We never trust the calculation alone for a ruling.
- **Channel text uses NO `parse_mode`, with one tiny carve-out.** Arabic
  du'a/Quran references contain `* _ ( ) <` etc. that Markdown/HTML would
  400 on. Plain text renders Arabic + emoji perfectly, so it is the
  default for every post. The single exception is the three long azkar
  (morning / evening / pre-sleep): they use `parse_mode: 'HTML'` for a
  **bold title** only — the body stays normal-size plain text. This is safe
  because (a) in HTML mode only `& < >` are special and the azkar text has
  none, and (b) `azkarHtml` (`content/format.ts`) runs every part through
  `escapeHtml`, so a future edit that adds one of those characters still
  can't 400. HTML tags do NOT count toward the 4096-char limit — the limit
  is on the rendered text — so the schedule test measures `renderedText(...)`,
  not the raw markup. Everything else stays plain.
  - We tried an **expandable blockquote** to collapse the long list in the
    feed, but Telegram renders blockquote text in a smaller, condensed font
    and the Bot API has no font-size control. Readable normal-size du'a beat
    the tidy-but-tiny block, so we dropped it. The Arabic-Indic numbering
    (`١. ٢. ٣.`) carries the readability instead.
- **Inline URL buttons link the referenced suras.** The bot references
  Quran, never reproduces it, so a one-tap link is the natural action:
  `pre_sleep` carries «سورة المُلك / السجدة / الكافرون» (quran.com),
  `friday_sunnah` «سورة الكهف», and the pinned welcome «حصن المسلم».
  Buttons live on the schedule entry (`types.ts` → `MessageSchedule.buttons`,
  rows of `{ text, url }`) and on `welcome.ts` → `welcomeButtons`. Channels
  only allow inline keyboards, and URL buttons cost nothing against the 4096
  limit. The kit's `post()` does not take `reply_markup`, so we POST via the
  kit then attach the keyboard with `editMessageReplyMarkup`
  (`scheduler.ts#attachButtons`; the welcome script does the same). That keeps
  `post()` the single send path; a failed attach is logged and non-fatal (the
  button-less message still stands). No extra admin right is needed — the bot
  edits its own message. If you want this shared across the other bots, move
  the `reply_markup` passthrough into `telegram-broadcast-kit` and ship a tag.
- **Poll options are `InputPollOption` objects.** Bot API 7.3+ changed
  `options` from strings to `{ text }[]`; `lib/post.ts` does the map.
- **Poll text is bidi-isolated (`rtlIsolate`).** Each option + the
  question is wrapped in Unicode RLI…PDI (U+2067…U+2069) in
  `lib/post.ts`. With no `parse_mode` the HTML `dir="rtl"` fix is out;
  the isolate is the standards-correct plain-text equivalent — it pins
  the line RTL and walls it off from the vote %/count Telegram appends,
  which was rendering on top of the emoji. Content also keeps the emoji
  at the _end_ of each string (see `content/poll.ts`). Keep both.
- **`close_date` is clamped.** `sendPollToChannel` forces the close time
  into Telegram's 5s … ~30d window so bad config can't 400 the API.
- **Admin commands optional.** Empty `ADMIN_TELEGRAM_ID` → no-ops.
- **No retry on send failure.** Logged, tick lost, next fire takes over.

## Content authenticity (the spiritual core)

The bot's purpose is reward, so wrong attribution to the Prophet ﷺ is
the worst failure mode. Every file in `src/content/` is verified
against its sources — Bukhari, Muslim, the Sunan with their gradings,
and the canonical **حصن المسلم** — and lists its own takhreej (تحقيق)
plus a scholar-review notice. Quran is referenced ("اقرأ سورة كذا"),
not reproduced, to avoid transcription error; where a du'a echoes an
ayah it is marked as a du'a, not a Prophetic (marfūʿ) text. Before any
real launch the content must be reviewed once by a trusted طالب علم.
Keep those notices in the files.

The three azkar files (`morningAzkar.ts`, `eveningAzkar.ts`,
`preSleep.ts`) mirror حصن المسلم's chapter order item-for-item, with
dhikr text taken verbatim from hisnmuslim.com. Any item added outside
Hisn's chapter (e.g. سورة الكافرون قبل النوم) is marked as «توسعة
مقصودة» in that file's takhreej header, with its independent isnad
and grading. Telegram's hard 4096-char limit per message applies: when
adding items, check each file's reported margin first — `morningAzkar`
already runs near the limit, so any growth requires a trim elsewhere
in the same file or a schedule split.

The akhlaq library (`content/akhlaq.ts`) follows the same discipline,
adapted to its different shape (a pool of short, independent vignettes
across four streams — خُلُق، هَدْي النبي ﷺ، الصحابة، حِكَم). Every
marfūʿ text is **sahih or hasan** with its takhreej in the comment above
it; Companion material is presented as أثر/سيرة, never as a Prophetic
report; and the file's header lists its reference sources (الأدب المفرد،
رياض الصالحين، الشمائل المحمدية، and dorar.net's موسوعة الأخلاق +
الموسوعة الحديثية for tabwīb and grading). When adding an item, verify
the grading on dorar.net/hadith or sunnah.com first, keep the stream
emoji at the **start** of the title (it is the rotation's visual tag),
and stay well under the 4096 limit (a test caps each at 900). Prefer texts
that are unambiguously sahih/hasan: avoid hadiths with a real
authentication dispute even if one grader passes them (the «أدِّ الأمانة
… ولا تخن من خانك» wording was dropped for exactly this — Albani graded it
sahih but al-Shafiʿi, Abu Hatim, Ibn al-Jawzi and Ibn Hajar weakened it).

**Pool size is not just about volume — it sets the repeat interval, and
it does so non-obviously.** `pickForDay` indexes by day-of-year, so an
item normally reappears every `length` days, but the year-boundary phase
reset can shorten that gap, and how much depends sharply on the size:
41 items → 37-day minimum gap, but 40 or 45 → a jarring ~5-day gap. The
pool is currently **41** (a deliberate, well-spaced value); a min-gap test
in `akhlaq.test.ts` fails if a resize lands on a bad value. Keep it ≥ 28,
and if you change it, run the tests — a red min-gap means nudge by ±1.

## How to change what it posts

1. Message text → edit the file in `src/content/`.
   - The daily akhlaq vignettes → edit the `akhlaqReminders` array in
     `src/content/akhlaq.ts`. Each entry is one vignette (stream emoji +
     title, then body), with its takhreej in the comment above it. Order
     is interleaved so the streams alternate day to day; keep the pool
     ≥ 28 and every marfūʿ text sahih/hasan. See the authenticity note.
2. The poll → edit `src/content/poll.ts` (stay anonymous + multi;
   keep any emoji at the **end** of each option/question and leave a
   little margin under 100 chars — `rtlIsolate` adds 2; see below).
   The base list is 9 items; Mon/Thu nights add one fasting option,
   so the total stays ≤ 10 (Telegram's hard max). If you grow the
   base list above 9, the Mon/Thu variant overflows — tests will
   catch it.
3. Times / new schedules → edit `src/schedules.ts`.
   The framework code does not need to change.
4. Sura/reference links under a message → edit that schedule's `buttons`
   in `src/schedules.ts` (rows of `{ text, url }`); the welcome's are in
   `src/content/welcome.ts` → `welcomeButtons`. Use `https://` URLs and
   keep button text short. See the inline-buttons design note above.

## Environment variables

| Variable             | Required | Notes                                                             |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `BOT_TOKEN`          | yes      | From @BotFather                                                   |
| `CHANNEL_CHAT_ID`    | yes      | Numeric `-100...` (recommended) or `@channel`                     |
| `CHANNEL_PUBLIC_URL` | no       | Public link for `/start` only; decoupled from sending             |
| `ADMIN_TELEGRAM_ID`  | no       | Enables /admin\_\* commands                                       |
| `TZ_NAME`            | no       | Cron timezone. Code default UTC; `.env.example` sets Africa/Cairo |
| `STATE_FILE`         | no       | Pointer file path. Default `./data/last-message-ids.json`         |
| `NODE_ENV`           | no       | `production` for hosted                                           |
| `PORT`               | no       | /health server port (default 8080)                                |

`CHANNEL_CHAT_ID` is sent to Telegram as-is; the numeric id is the safe
production choice because it survives a username rename. The public
link is deliberately a separate, optional variable so the cosmetic link
can never break posting. If `CHANNEL_PUBLIC_URL` is unset, the link
falls back to deriving from an `@username` chat id, else `/start` shows
no link.

## Common gotchas

- The bot must be a channel admin with **two** rights granted:
  - **"Post messages"** — without it `sendMessage`/`sendPoll` 403s.
  - **"Delete messages"** (`can_delete_messages`) — without it the
    replace-on-next-fire cleanup fails. This admin right also removes
    Telegram's 48h `deleteMessage` cap, which matters because
    `friday_sunnah` is weekly (its previous copy is 7 days old). The
    failure is non-fatal (logged), so an unconfigured deploy still
    posts; old copies just accumulate until the right is granted.
- Invalid cron is validated at boot, logged, and that one schedule is
  skipped; the rest still run.
- DST: node-cron silently drops a job whose wall-clock time does not
  exist on the spring-forward day. Africa/Cairo jumps 00:00 → 01:00 on
  the last Friday of April, so keep schedules at 02:00+ to be safe.
- Tests load `config.ts` transitively; `vitest.config.ts` injects dummy
  env so they need no real token.
- Ephemeral hosting (Heroku-style) wipes `data/` on every deploy. The
  bot still works — it just degrades to "one stale copy per schedule
  per deploy" until the next cycle. On hosts with a persistent disk
  (Railway, VPS, Docker volume) cleanup is exact across restarts.

## Testing

`pnpm test` runs fast unit tests with no network or database. They
cover: schedule and Telegram poll constraints, `post.ts` success and
failure mocks (including close_date clamping and `deleteChannelMessage`),
`runSchedule` kind dispatch + the `keepLast` ring buffer (first fire
posts only, message-default-1 deletes previous on second fire, polls
without `keepLast` are never tracked, the synthetic `keepLast: 2` case
fills then evicts oldest on third fire, failed posts leave state,
`night_review_poll` is wired for replace-on-next-fire with `keepLast: 1`),
`lib/state.ts` (empty/corrupt file resilience,
legacy single-number migration, array round-trip, clear-on-empty,
parent-dir creation), `startScheduler` skipping an invalid cron,
`pickContent` (blank and array handling), `channelUrlFrom`,
`resolvePort`, the `skipIf` guard (skips the post + leaves the ring
buffer untouched), the silent-rider split (anchors ring, the akhlaq /
Friday / fasting / pre-sleep riders carry `silent: true`, and `post.ts`
sends `disable_notification` only when asked), the akhlaq daily-rotation
library (`content/akhlaq.ts`: pool ≥ 28, non-blank + length-capped,
no duplicates, every vignette opens with a stream emoji, `pickForDay`
never repeats on consecutive days across 4 years incl. the 2028 leap day,
and no item reappears within ~3 weeks — the min-gap test that pins the
repeat interval against a bad pool size; plus `schedules.ts`
pins `selection: 'daily'` + `keepLast: 0` and the fire-before-evening
order, and `runSchedule` posts the daily pick idempotently within a day
and never tracks/deletes it), `content/format.ts` (the azkar
HTML: bold title only, `escapeHtml`, and `renderedText` round-tripping the
HTML back to the byte-exact plain source so the 4096 check measures what
Telegram renders), the inline-button specs (every button has non-empty
text and an `https://` URL; `runSchedule` attaches them via
`editMessageReplyMarkup` only when present and a failed attach is
non-fatal), and `lib/hijri.ts` (Umm al-Qura mapping; Eid/Tashreeq
suppression incl. the +1 day-14 cushion; عرفة and ستّ من شوّال never
suppressed; the poll drops «صيام» on a Tashreeq day).
The count is intentionally not stated here so it never goes stale.

`pnpm check` runs `typecheck` + `format:check` + `test` — the same gate
CI enforces. The deploy workflow (`.github/workflows/deploy.yml`) runs it
in a `test` job on every push to main AND every pull request; the `deploy`
job has `needs: test` and only fires on a push, so a red check never
reaches the VPS and a PR never deploys. Run `pnpm check` before pushing.

`pnpm send-test` runs `scripts/send-test.ts`: a manual dev tool that
fires every schedule once via the same `runSchedule` the cron loop
uses, then exits. Four properties matter:

- It calls `bot.api.getChat(channelChatId)` as a preflight before
  posting anything. A bad token, wrong chat id, or invite-link slug
  pasted as the id fails fast with one clean diagnostic instead of
  N identical 400s scrolling past.
- Each session opens with a short Arabic banner posted directly via
  `postToChannel` (NOT through `runSchedule`), so it is never tracked
  in the state file and never auto-deleted. Banners therefore
  accumulate across runs by design — they mark each dev preview
  session in the channel scrollback. Delete old banners by hand.
- After the banner the schedules go through `runSchedule`, so
  re-running it auto-cleans the previous run's azkar/poll posts.
  Per-machine: the pointer file is local, so a `send-test` from a
  dev laptop and a real prod cron fire do not see each other's
  posts.
- Bail-on-first-failure: if the banner fails to send, OR if the
  first schedule fire fails, the script exits early instead of
  stacking N errors. After the first successful schedule fire it
  keeps going even if later schedules fail (likely content-specific).

Needs `.env` (BOT_TOKEN + CHANNEL_CHAT_ID) and the bot to be a
channel admin with "Post messages" + "Delete messages". Does NOT
require `ADMIN_TELEGRAM_ID` (unlike `/admin_run`). Not imported by
the app; safe to keep in the repo.

`pnpm post-welcome` runs `scripts/post-welcome.ts`: posts (no args) or
edits-in-place (`pnpm post-welcome <message_id>`) the pinned welcome
message single-sourced in `src/content/welcome.ts`. Edit-in-place is
the normal mode: the pin stays, no notification fires. Outside the
cron loop and outside the ring-buffer state file on purpose — the
welcome is read once and pinned, not re-posted daily.

## Git

- Commit after each meaningful unit of work.
- Do NOT add Co-Authored-By in commit messages.
