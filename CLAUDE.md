# Zaaduna (زادنا): Repo Guide

## What this is

A near-zero-state Telegram bot that posts daily Islamic reminders to one
channel and runs an **anonymous** self-review poll every other night ("a
night yes, a night no"). The poll is anonymous + multiple-answer on
purpose: Telegram aggregates the votes and shows percentages to everyone,
nobody (including this bot) learns who voted. That delivers community
motivation with no riya and no DB.

It posts **two short readings a day** from two independent growing
libraries: a morning «آداب وسنن وأخلاق القلب» reading (`content/adab.ts` —
what to DO today) and an evening «أخلاق وشمائل» reading (`content/akhlaq.ts`
— who to BE). On top of the nightly review poll it also runs a **weekly
anonymous situational-adab quiz** every Friday (`content/quiz.ts`: a موقف +
the best response + an explanation, Telegram quiz-mode), and the night poll
carries a rotating **بِرّ (حقوق العباد)** option so the محاسبة covers
dealing with people, not only personal worship. All the extra posts ride
**silently** inside existing sessions, so the calm "one ping per session"
cadence is unchanged. **Authenticity note:** the large content libraries
were drafted with takhreej in the comments and every grading flagged
`[راجعه طالب علم]`; a trusted طالب علم review is still required before launch
(the same rule as the rest of `src/content/`).

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
│   ├── content/        Arabic content modules + poll spec + welcome.ts + format.ts (azkar HTML) + akhlaq.ts (evening daily-rotation library) + adab.ts (morning daily-rotation library) + quiz.ts (weekly situational-adab quiz)
│   ├── content/cards.ts  azkar card variant (1/2 by day) + path helper
│   └── lib/            hijri (Umm al-Qura no-fast days) + fileCache (card file_id cache)
├── assets/cards/       azkar card PNGs (variant 1/2), copied into the image
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

- **Daily-rotation growing library (`selection: 'daily'` + `keepLast:
0`).** Most posts are fixed or repeating. `akhlaq_reminder` is different:
  it has a big list of short posts (أخلاق المسلم، هَدْي النبي ﷺ، الصحابة،
  حِكَم جامعة) and shows one new item each day. Two settings make this work:
  - `selection: 'daily'` (`types.ts` → `MessageSchedule`) picks the item by
    day-of-the-year using the kit's `pickForDay`, in `config.timezone` (never
    `Date.getDay()`). Result: the same date always shows the same item, two
    days in a row never show the same one, and the whole list is shown before
    any repeat. It keeps **no saved state**, so it just works after a restart
    (unlike the ring buffer, which needs the pointer file).
  - `keepLast: 0` turns the ring-buffer cleanup OFF, so nothing is ever
    deleted. The channel keeps every post and slowly builds a library people
    can scroll and share (the opposite of the azkar, which keep one copy).
    The code is in `scheduler.ts#sendForKind` (it checks `selection`);
    `content/akhlaq.ts` holds the list; a test checks two days never repeat.

- **Two reading libraries (morning + evening).** The same daily-rotation
  pattern runs TWICE a day from two independent pools, so a follower gets
  two short, different readings: `morning_adab` (`content/adab.ts`, 05:31,
  silent) is the **آداب/سنن/أخلاق القلب** library — a practice to live by
  today — and `akhlaq_reminder` (`content/akhlaq.ts`, 16:58, silent) is the
  **أخلاق/شمائل** library — a character to reflect on. Separate arrays, so
  `pickForDay` never collides on the same day; each carries `selection:
'daily'` + `keepLast: 0` (a growing archive). Both stay near the **optimal
  spacing zone** the UX/learning research pointed to (a ~few-week-or-more
  repeat gap), so growing a pool is the right maintenance — don't shrink it.
  Each file has a min-gap test; the library SIZE matters at the Jan-1 reset,
  so if you change a count and the test goes red, nudge it by 1 (akhlaq is
  79, adab 66 — both chosen to pass).

- **Weekly situational-adab quiz (`content/quiz.ts`, `friday_quiz`).** A
  Telegram **quiz poll** (`type: 'quiz'`): a موقف + 2–4 options, ONE correct,
  plus an `explanation` (≤200 chars) shown after voting. Anonymous, no
  scoring, framed as learning («موقفٌ نتعلّم منه») not a piety test. Fires
  every Friday and rotates **weekly** (`weekNumberInTz`), riding silently
  before the evening azkar; `keepLast` defaults to 0 so quizzes accumulate as
  a browsable archive. **Hard rule:** only adab that is agreed-upon / grounded
  in explicit nass — never contested fiqh, never a halal/haram ruling (the
  quiz format cannot express "it depends"). A quiz can't be edited after
  votes start, so the طالب علم review must happen **before** it fires. The
  kit's `sendPoll` already supports quiz mode (`PollSpec.type/correctOptionId/
explanation`); the bot's local `PollSpec` mirrors those fields.

- **The night poll: fixed worship core + two rotating slots, framed
  today-and-tomorrow.** `buildNightReviewPoll` keeps a FIXED daily-worship core
  (`CORE_WAKE` + `CORE_NIGHT`: fajr, adhkar, Qur'an, duha, khushūʿ+dhikr,
  istighfar, qiyam, Mulk) shown every night — the "initial" essentials never
  rotate out. Between them it inserts TWO rotating slots, one each per night:
  a أخلاق/قلب self-check (`AKHLAQ_CHECKS`, 7) and a بِرّ/حقوق-العباد deed
  (`BIRR_DEEDS`, 6: صدقة / إطعام / صلة رحم / تفريج كربة / برّ الوالدين / عيادة
  مريض). So a wider set of character + dealing-with-people topics is reviewed
  across the days without the list growing; the two pools have different
  lengths so the pairing varies too. Both advance one step per poll night via
  `rotateForNight` (`floor(dayNumber/2)`, since the poll fires every other
  night), tz-keyed/stateless like `isPollNight`. The QUESTION is framed as a
  محاسبة for today AND a نيّة for tomorrow ("tick what you did today; what you
  missed, resolve for tomorrow"), so a late or forward-looking reader still
  benefits. Net option count: 10 most nights, 11 on Mon/Thu (the صيام option) —
  Telegram raised the per-poll cap to **12** (Bot API 9.1, Jul 2025), so this
  fits with headroom. Tests pin: exactly one أخلاق + one بِرّ each night, both
  walk their whole pool, and the worship core is present every night.

- **One ping per session (`silent` riders).** What makes people mute a
  channel is the number of separate notification moments, not the message
  count. So each session has one anchor that rings and the rest ride in
  with `silent: true` (Telegram `disable_notification`): they still appear
  in the channel, they just do not buzz. Anchors (ring): `morning_azkar`,
  `evening_azkar`, `night_review_poll`. Riders (silent): `morning_adab`
  (after the morning azkar), `friday_sunnah` (after the morning azkar),
  `akhlaq_reminder` and `friday_quiz` (before the evening azkar),
  `fasting_reminder` and `pre_sleep` (before the night poll). Net: **3 pings
  on a poll night, 2 on an off night** — the night poll fires every other
  night (see the poll-cadence note below), and on its off nights the bedtime
  window has no audible anchor (`pre_sleep` stays silent), so nothing rings
  at bedtime. The flag lives on the schedule entry (`types.ts` →
  `BaseSchedule.silent`), the scheduler passes it to `lib/post.ts`, and a
  test pins the anchor/rider split.

- **Anonymous poll, not per-user tracking.** Streaks/personal history
  would need a DB and a subscriber bot, and re-introduce showing-off
  (riya). The anonymous poll keeps motivation without either. Do not
  "upgrade" this without a deliberate decision.
- **The poll fires every other night ("a night yes, a night no").**
  `night_review_poll` carries a `skipIf` that suppresses it on alternate
  nights (`skipIf: (now) => !isPollNight(now, config.timezone)`), so the
  nightly self-review becomes an every-other-night one — a gentler bedtime
  cadence. `isPollNight` (`content/poll.ts`) keys off the **civil date in
  `config.timezone`** (turned into a stable day number whose parity flips
  each calendar day), never `Date.getDay()`/the host clock — same discipline
  as `weekdayInTz`/`pickForDay` — so a given date is always the same verdict,
  two consecutive nights never match, and it needs **no saved state** (the
  `skipIf` path leaves the ring buffer untouched, so the previous poll just
  stays until the next poll night replaces it). Flip the `=== 0` in
  `isPollNight` to shift the phase by one day. Trade-off accepted on purpose:
  the daily محاسبة becomes every-other-day, and Mon/Thu fasting self-review
  is only offered on the poll nights that land on Mon/Thu (the fasting
  _reminder_ still fires on its own schedule). A test pins the alternation,
  determinism, and tz-awareness.
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
  **bold title** plus a **partial expandable blockquote** (see below). This
  is safe because (a) in HTML mode only `& < >` are special and the azkar
  text has none, and (b) `azkarHtml` (`content/format.ts`) runs every part
  through `escapeHtml`, so a future edit that adds one of those characters
  still can't 400. HTML tags do NOT count toward the 4096-char limit — the
  limit is on the rendered text — so the schedule test measures
  `renderedText(...)`, not the raw markup. Everything else stays plain.
  - **Partial expandable blockquote.** Each azkar is ~3–4k chars; flat, one
    of them is a screen-and-a-half wall that buries the rest of the feed. So
    `azkarHtml` keeps the **bold title + the intro paragraph at full size**
    (the readable hook) and wraps **the long du'a list in
    `<blockquote expandable>`** — collapsed in the feed to a few preview
    lines + "Show more". Why "partial" and not the whole body: Telegram
    renders blockquote text in a smaller, condensed font with no size
    control, so only the deliberately-expanded list takes the smaller font;
    the hook stays normal-size. We previously shipped a flat full-size list
    (and rejected a FULL expandable for the small font); this is the middle
    ground. The split is content-agnostic — title = first line, intro =
    first paragraph, body = from the second blank line on — and every azkar
    file follows that shape (title / blank / intro / blank / list). The
    Arabic-Indic numbering (`١. ٢. ٣.`) still carries the in-list readability.
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
- **Day-alternating azkar cards (variant 1/2).** The three azkar
  (morning/evening/pre-sleep) each attach a card image that alternates by the
  civil date in `config.timezone`: **variant 1** on even day-numbers, **variant
  2** on odd — so all three share the day's variant and consecutive days
  swap ("a day this, a day that"). The variant is `content/cards.ts →
cardVariantFor` (epoch day-parity, tz-keyed/stateless, same discipline as
  `isPollNight`); paths come from `azkarCard(base)` and are set on the schedule
  entry (`types.ts → MessageSchedule.images: { first, second }`). The azkar text
  far exceeds Telegram's **1024-char photo caption**, so the card is its OWN
  message — a **silent** photo (`disable_notification`) sent just ABOVE the
  text, so the text stays the audible anchor and the one-ping rule holds. The
  kit has no photo helper, so `scheduler.ts#sendCard` calls `bot.api.sendPhoto`
  directly (like `attachButtons` uses `editMessageReplyMarkup`). It is tracked
  under a separate `${name}::card` state key with its own replace-on-next-fire
  (send new, then delete previous), so the text ring buffer is untouched; a
  send failure is logged and non-fatal (the card-less text still posts). The
  images live in **`assets/cards/`** and are copied into the Docker image
  explicitly (`Dockerfile` — `tsc` does not copy non-TS files into `dist/`).
  Telegram photo limits respected: width+height ≤ 10000, ratio ≤ 20, ≤ 10MB
  (the cards are ~3360×≤6500). To swap art, replace the PNGs in `assets/cards/`
  keeping the `{base}-{1,2}.png` names.
- **Cards upload ONCE, then resend by `file_id` (`lib/fileCache.ts`).** The
  naive `sendPhoto(new InputFile(path))` re-uploads the bytes every fire, and
  Telegram mints a NEW `file_id` each time — so to a client it is a file it has
  never seen, and it shows a loading spinner and re-downloads, even though the
  bytes are the exact same card it showed two days ago (there are only 6 files).
  Fix: `scheduler.ts#postCard` hashes the card bytes, and on a cache hit resends
  by the cached `file_id` STRING (Telegram serves its own copy, no upload, and
  clients render instantly — this is what kills the "still loading?" feel); on a
  miss it uploads via `InputFile` and caches the `file_id` Telegram returns. A
  `file_id` stays valid after the message that carried it is deleted (it points
  at the file object, not the message), so this is fully compatible with the
  card's replace-on-next-fire. The cache is keyed by a **hash of the file
  bytes**, not the path, so swapping the art (same filename) misses and
  re-uploads automatically — no manual cache-busting. A cached id can rarely go
  stale (server purge); on a **400** from the file_id send `postCard` drops it
  and re-uploads, but a transient error (429/network) keeps the id so the next
  fire can still reuse it (no cache churn). The store
  is a tiny JSON file (`config.fileIdCachePath`, default `./data/file-ids.json`,
  gitignored, loaded by `initFileCache` in `index.ts`) — same "pointer file, not
  a database" weight as `lib/state.ts`: lose it and each card just re-uploads
  once, then caches again. file_ids are bot-specific, so the file is per-bot
  (never shared/committed). This is deliberately zaaduna-local, not a
  `telegram-broadcast-kit` helper: among the kit's consumers only zaaduna sends
  photos, and it mirrors the caller-owns-the-cache shape the subscriber bots
  (tilawah/ayah, on the separate `telegram-bot-kit`) already use — a clean lift
  into the kit if a second broadcast bot ever needs media.
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

The same authenticity discipline applies to the morning **`content/adab.ts`**
library (streams 📿 سُنن/آداب، 🤲 أخلاق القلب، 🚫 ما نتجنّبه) and the weekly
**`content/quiz.ts`** scenarios — every marfūʿ text sahih/hasan with takhreej
in its comment, all flagged `[راجعه طالب علم]` pending the one required review.

**The list size also controls how soon a post repeats, in a non-obvious
way.** `pickForDay` picks by day-of-the-year, so a post normally comes back
every `length` days. But on Jan 1 the day counter resets, which can make a
few posts come back sooner, and how much sooner depends a lot on the size. So
the counts are chosen on purpose: **akhlaq.ts is 79, adab.ts is 66** (both
clear the min-gap test's floor). A test in `akhlaq.test.ts` / `adab.test.ts`
measures the shortest gap and fails on a bad size. Keep each list at 28 or
more, and if you change a count, run the tests; if the min-gap test goes red,
change the count by 1 and try again.

## How to change what it posts

1. Message text → edit the file in `src/content/`.
   - The two daily readings → edit `akhlaqReminders` in `src/content/akhlaq.ts`
     (evening: خُلُق / هَدْي النبي ﷺ / صحابة / حِكَم) and `adabReminders` in
     `src/content/adab.ts` (morning: 📿 سُنن وآداب / 🤲 أخلاق القلب / 🚫 ما
     نتجنّبه). Each entry is one short post (stream emoji + title, then body),
     with its source in the comment above it; items are mixed so the streams
     take turns day to day. Keep each list at 28+ and every saying about the
     Prophet ﷺ sahih or hasan. See the authenticity + list-size notes above.
2. The weekly quiz → edit `adabQuizzes` in `src/content/quiz.ts` (a موقف +
   2–4 options + the correct index + a ≤200-char explanation). Anonymous
   quiz-mode, agreed-upon adab only (never contested fiqh), gentle tone; the
   طالب علم review must come **before** it fires (no editing after votes).
3. The night poll → edit `src/content/poll.ts` (stay anonymous + multi;
   keep any emoji at the **end** of each option/question and leave a
   little margin under 100 chars — `rtlIsolate` adds 2; see below).
   The list is a fixed worship core (8: `CORE_WAKE` + `CORE_NIGHT`) + one
   rotating أخلاق check (`AKHLAQ_CHECKS`) + one rotating بِرّ deed
   (`BIRR_DEEDS`) = 10 most nights; Mon/Thu nights add one fasting option → 11.
   Edit the pools to add topics; keep the worship core fixed. Telegram now
   allows **12** options per poll (Bot API 9.1), so there is headroom, but
   tests pin the exact counts. The poll fires every OTHER night (`isPollNight`
   - `night_review_poll.skipIf` — see the poll-cadence design note); to make
     it nightly again, drop that `skipIf` in `schedules.ts`, and to shift
     which nights it lands on, flip the `=== 0` in `isPollNight`.
4. Times / new schedules → edit `src/schedules.ts`.
   The framework code does not need to change.
5. Sura/reference links under a message → edit that schedule's `buttons`
   in `src/schedules.ts` (rows of `{ text, url }`); the welcome's are in
   `src/content/welcome.ts` → `welcomeButtons`. Use `https://` URLs and
   keep button text short. See the inline-buttons design note above.

## Environment variables

| Variable             | Required | Notes                                                                   |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `BOT_TOKEN`          | yes      | From @BotFather                                                         |
| `CHANNEL_CHAT_ID`    | yes      | Numeric `-100...` (recommended) or `@channel`                           |
| `CHANNEL_PUBLIC_URL` | no       | Public link for `/start` only; decoupled from sending                   |
| `ADMIN_TELEGRAM_ID`  | no       | Enables /admin\_\* commands                                             |
| `TZ_NAME`            | no       | Cron timezone. Code default UTC; `.env.example` sets Africa/Cairo       |
| `DATA_DIR`           | no       | Dir for the bot's two JSON files (state + card cache). Default `./data` |
| `NODE_ENV`           | no       | `production` for hosted                                                 |
| `PORT`               | no       | /health server port (default 8080)                                      |

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
buffer untouched), the poll's every-other-night alternation
(`isPollNight` + `night_review_poll.skipIf`: flips each calendar day so
consecutive nights never match, is deterministic per date, keys off the tz
civil date not the host clock, and the schedule's `skipIf` equals
`!isPollNight`), the silent-rider split (anchors ring, the akhlaq /
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
HTML: a bold title plus a single partial expandable blockquote — title +
intro stay outside it, the long du'a list is collapsed inside it — `escapeHtml`,
and `renderedText` round-tripping the HTML back to the byte-exact plain source
so the 4096 check measures what Telegram renders), the inline-button specs (every button has non-empty
text and an `https://` URL; `runSchedule` attaches them via
`editMessageReplyMarkup` only when present and a failed attach is
non-fatal), `lib/hijri.ts` (Umm al-Qura mapping; Eid/Tashreeq
suppression incl. the +1 day-14 cushion; عرفة and ستّ من شوّال never
suppressed; the poll drops «صيام» on a Tashreeq day), the morning
`content/adab.ts` library (same pool-health + daily-rotation + min-gap
guards as akhlaq, with its 📿/🤲/🚫 streams), the night poll's بِرّ slot
(exactly one rotating deed every night, advances once per poll night, tz-keyed
and deterministic), and `content/quiz.ts` (the weekly quiz: pool health +
every Telegram quiz constraint — options 2–4, distinct, ≤100, explanation
≤200 with ≤2 line breaks, `correctIndex` in range, varied correct slot — plus
`buildWeeklyQuiz` weekly rotation that is deterministic, tz-keyed, and walks
the whole pool before repeating), and the azkar cards (`content/cards.ts`:
`cardVariantFor` alternates variant 1/2 each civil day, all three azkar share
the day's variant, tz-keyed + deterministic, and the PNG files exist on disk; plus
`scheduler.ts` — a card is sent as a SILENT photo before the text, replaced on
the next fire under a separate `${name}::card` key, and a photo failure is
non-fatal so the text still posts), and the card file_id cache
(`lib/fileCache.ts`: hash/get/set/drop round-trips, missing/corrupt/tampered
files start empty without throwing, disk persistence across a reload; plus
`scheduler.ts#postCard` — a cold cache uploads via `InputFile` and caches the
returned file_id, a warm cache resends by the file_id string with no upload,
and a stale id is dropped and re-uploaded once).
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
