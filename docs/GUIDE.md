# Working on Zaaduna (a guide for new contributors)

This is the friendly, plain-English guide. Read it once and you will know
how the bot works, how to run it on your machine, how to make the common
changes, and the traps to avoid. No prior knowledge of the project is
assumed.

If you want the deep, dense reference (every design decision and why),
read `CLAUDE.md` after this. This guide is the gentle on-ramp; `CLAUDE.md`
is the encyclopedia.

## 1. What the bot does, in one paragraph

Zaaduna posts daily Islamic reminders to one Telegram channel: morning and
evening azkar, a couple of short readings, a Friday sunan post and quiz,
and an anonymous night self-review poll every other night. There is no
database and no per-user data. Everything it posts is written in source
files. To change what it posts, you edit a file and restart the bot. That
is the whole idea: very few moving parts, so it can run untouched for
years.

## 2. The mental model (how a post happens)

Three steps, top to bottom:

1. `src/schedules.ts` is a plain list. Each entry says "at this cron time,
   post this thing." A thing is either a message (`kind: 'message'`) or a
   poll (`kind: 'poll'`).
2. At startup, `src/scheduler.ts` hands every entry to node-cron.
3. When a cron time fires, the scheduler runs that entry: it builds the
   text or poll and sends it to the channel.

That is it. If you understand those three steps, you understand the bot.

The shared, generic plumbing (logging, reading env vars, the cron runner,
the send helpers, the tiny state file, the health endpoint) does not live
in this repo. It lives in a dependency called `telegram-broadcast-kit`
that several bots share. This repo only holds what is special to Zaaduna:
the schedule list, the Arabic content, and the glue in `scheduler.ts`.

## 3. The files you will touch most

| File                               | What it is                                    | When you edit it                              |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `src/schedules.ts`                 | The list of what to post and when             | Change a time, add a post, mark a post silent |
| `src/content/*.ts`                 | The actual Arabic texts, polls, quiz          | Change the words people read                  |
| `src/content/poll.ts`              | The night self-review poll                    | Change the checklist options                  |
| `src/content/akhlaq.ts`, `adab.ts` | The two daily reading libraries               | Add a short reading                           |
| `src/content/quiz.ts`              | The weekly Friday quiz                        | Add a scenario question                       |
| `src/lib/`                         | hijri (no-fast days), fileCache (card images) | Rarely                                        |

Most days you only touch `schedules.ts` and a file in `content/`.

## 4. Run it on your machine

You need Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
```

Open `.env` and set at least these two:

- `BOT_TOKEN` from @BotFather on Telegram.
- `CHANNEL_CHAT_ID` the numeric `-100...` id of your channel (the
  `.env.example` file explains two easy ways to find it).

Then add your bot to the channel as an admin with both "Post messages" and
"Delete messages" turned on. Without "Post messages" every send fails with
a 403. Without "Delete messages" the cleanup of old posts fails (it is not
fatal, old copies just pile up).

Now run:

```bash
pnpm dev          # runs with auto-restart on save
```

To see every post right now instead of waiting for the real times:

```bash
pnpm send-test    # posts everything once to the channel, then exits
```

`send-test` is the fastest way to eyeball your change in a real channel. It
reuses the exact production send code, so what you see is what subscribers
will see.

## 5. The handful of ideas that make it tick

You do not need these to make a wording change, but you will meet them in
the code, so here is the short version of each.

**No database.** Config and content are in source. The one tiny exception
is a small JSON file under `data/` that just remembers the message ids the
bot posted, so it can delete the old copy next time. It is not a database,
it has no schema, and losing it only means a few stale posts linger. Think
of it as the same weight as the `.env` file.

**Replace on next fire (ring buffer).** Repeating posts like the azkar
would pile up a year of identical copies and bury the pinned welcome. So
each repeating post keeps only the latest copy: when today's azkar posts,
yesterday's is deleted. Anything a human posted by hand (your welcome, a
pinned intro) is never touched.

**Daily rotation libraries.** The two readings (`akhlaq.ts` and `adab.ts`)
are big lists of short posts. Each day shows one item, picked by the day of
the year, so the same date always shows the same item, two days in a row
never match, and the whole list is shown before any repeat. These are kept
forever (not deleted) so the channel slowly grows a browsable archive.

**Silent riders (one ping per session).** What makes people mute a channel
is the number of separate buzzes, not the number of messages. So in each
time window only one post makes a sound (the "anchor") and the others ride
in silently (Telegram's `disable_notification`). They still appear, they
just do not buzz. The flag is `silent: true` on the schedule entry. Net
result is three buzzes a day at most.

**The poll fires every other night.** The night self-review poll runs "a
night yes, a night no" for a gentler bedtime cadence. The decision is
computed from the calendar date in the bot's timezone, so it needs no saved
state and is the same for everyone.

**Hijri-aware fasting.** Voluntary fasting is forbidden on the two Eids and
the days of Tashreeq. The Monday/Thursday fasting nudge and the poll's
fasting option are automatically withheld on those days, read from the Umm
al-Qura calendar. See `src/lib/hijri.ts`. Arafah is never withheld.

**Seasonal fast reminders.** Beyond the weekly Monday/Thursday nudge, the bot
also reminds about the season-bound voluntary fasts: عاشوراء + تاسوعاء، يوم
عرفة، ستّ من شوّال، والأيّام البيض. Each one fires on the **eve** of the
occasion. Because the channel is read worldwide off one calculated calendar
and local moon-sightings differ by up to a day, each reminder is framed as a
**window** (it states the Umm al-Qura date "بتوقيت القناة" but tells the reader
to follow their own country's sighting), and for عاشوراء it recommends fasting
the 9th, 10th and 11th — at once the most complete level and the safe hedge
when the month's start is uncertain. When a special fast falls on a
Monday/Thursday, the generic nudge steps aside so you never get two reminders
the same night, and the poll names the fast by occasion. See
`src/content/specialFasts.ts`.

**Azkar cards upload once.** Each azkar attaches a card image. The naive way
re-uploads the image every time, which makes Telegram treat it as a brand
new file so clients show a loading spinner and download it again. Instead the
bot uploads each card once, remembers the Telegram `file_id` (in a small
cache file), and resends by that id after, so it loads instantly. Swapping
the PNG art is detected automatically because the cache is keyed by the file
content, not its name. See `src/lib/fileCache.ts`.

**Arabic text uses no parse mode.** Arabic and Quran references contain
characters that Markdown or HTML would choke on and return a 400. So posts
are sent as plain text. The only exception is the three long azkar, which
use a small, safe slice of HTML for a bold title and a collapsible quote.

## 6. How to make the common changes

**Change the wording of a post:** edit the matching file in `src/content/`.
Restart (or redeploy). Done.

**Add a daily reading:** add one entry to `adabReminders` in `adab.ts`
(morning) or `akhlaqReminders` in `akhlaq.ts` (evening). Keep the stream
emoji at the start of the title. Every saying about the Prophet ﷺ must be
sahih or hasan, with its source in a comment above it. Each file header
explains the rules and a test will tell you if the list size is off.

**Change the night poll options:** edit `src/content/poll.ts`. Keep it
anonymous and multiple-answer. Keep any emoji at the end of each option.
The list is a fixed worship core plus one rotating character check and one
rotating "rights of people" deed each night.

**Add a Friday quiz question:** edit `adabQuizzes` in `src/content/quiz.ts`.
A scenario, two to four options, one correct answer, and a short
explanation. Use only agreed-upon adab grounded in clear text, never
contested fiqh, because a quiz cannot say "it depends." The scholar review
must happen before it goes live, since a quiz cannot be edited after votes
start.

**Change a time or add a new post:** edit `src/schedules.ts`. Cron times
are read in the `TZ_NAME` timezone. Day of week is `0` or `7` for Sunday,
`1` Monday, `5` Friday. Keep new times at 02:00 or later (see the gotcha
below).

**Change the card art:** replace the PNGs in `assets/cards/`, keeping the
existing file names. Nothing else to do.

## 7. Testing and the quality gate

```bash
pnpm test         # fast unit tests, no network, no database
pnpm typecheck    # TypeScript only
pnpm check        # typecheck + format check + tests (the full gate)
```

Run `pnpm check` before you commit. It is the same gate the CI runs on
every push and pull request, so if it is green locally it will be green in
CI. If formatting fails, run `pnpm format` to fix it automatically.

The tests are strict on purpose around the things that would quietly break
in production: Telegram's poll limits, the cleanup logic, the rotation
never repeating too soon, the timezone math, and the content being well
formed. When you add content, a test usually already checks its shape, so a
red test is often telling you something real.

## 8. Gotchas (read this before you are surprised)

- **Keep cron times at 02:00 or later.** Once a year the clock jumps from
  00:00 to 01:00 (daylight saving). node-cron silently drops any job whose
  time does not exist that day, so a 00:30 job would vanish for a day.
- **Arabic in messages: no Markdown or HTML.** It will 400. Plain text
  renders Arabic and emoji perfectly. The azkar HTML exception is handled
  for you in `content/format.ts`.
- **The bot needs two channel rights**, not one: "Post messages" and
  "Delete messages." Missing the second means old posts are not cleaned up.
- **Ephemeral hosts wipe `data/` on deploy.** That is fine. The bot still
  works, it just leaks one stale copy per post until the next cycle. On a
  host with a real disk the cleanup is exact.
- **Content authenticity is the whole point.** A wrong attribution to the
  Prophet ﷺ is the worst possible bug here. Before launch, a trusted طالب
  علم must read `src/content/*.ts` once. Keep the takhreej comments.

## 9. Where to go next

- `CLAUDE.md` for the full reasoning behind every design choice.
- `docs/DEPLOY.md` for deploying (Docker on a VPS is the main path).
- `FLYIO.md` for the Fly.io fallback.
- The header comment at the top of each `src/content/*.ts` file for the
  rules specific to that content.
