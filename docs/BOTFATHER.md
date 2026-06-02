# BotFather setup (copy and paste)

Ready-to-paste text for the Zaaduna bot in @BotFather (the `/mybots` ->
Edit Bot menu). The audience is Arabic, so the public texts are Arabic.
Copy each block as-is.

Note: this bot sets its command list AND its About + Description
automatically. On start it calls `setMyCommands` with a single `start`
command, then `setMyShortDescription` (About) and `setMyDescription`
(Description) — see `setBotProfile` in `src/bot.ts`, with the texts in
`src/content/profile.ts` (kept verbatim from the blocks below). So you do
NOT need to paste a Commands, About, or Description block into BotFather;
they appear on their own once the bot has run. (For contrast, the Fluent
Owls bot does not self-register and must have these pasted in by hand.) The
blocks below are kept only for manual setting and as the source of truth.

- Bot channel: **set your own handle** (e.g. `@zaaduna`).

---

## Name

زادُنا

## About

(BotFather "Edit About", max ~120 characters. Shown on the bot's profile.)

«زادُنا» 🌿 أذكار الصباح والمساء، سننُ الجمعة، أذكار النوم، واستبيانٌ سرّيٌّ لمراجعة الليلة. اضغط Start للقناة.

## Description

(BotFather "Edit Description", max ~512 characters. Shown on the empty-chat
start screen, before the user presses Start.)

🌿 أهلًا بك في «زادُنا»
قناةٌ هادئةٌ تُعينك على دوام ذكر الله، تنشر وِردًا يوميًّا في قناتها فقط:
• 🌅 أذكار الصباح 5:30 ص
• 🌇 أذكار المساء 5:00 م
• 🕌 سننُ الجمعة (الجمعة)
• 🌙 سورة المُلك وأذكار النوم 9:43 م
• 📋 استبيانُ مراجعةِ الليلة 9:45 م (سرّيٌّ تمامًا)
كل ليلة تختار ما أتممتَ من عملك، والتصويت مجهولٌ لا يرى أحدٌ اختيارك. لا حساب، ولا متابعة لأحد. اضغط Start لرابط القناة. (بتوقيت القاهرة)

---

## Commands

The bot self-registers this already (see the note above). If you ever want
to set it by hand: when BotFather says "Send me a list of commands", paste
exactly this block (no leading slashes, one command per line,
`command - description`):

start - عن هذا البوت ورابط القناة

---

## Other settings

- Botpic: optional, set your own image in BotFather.
- Privacy Policy: optional. The bot stores nothing about users (no votes,
  no personal history; the night poll is anonymous and only a tiny pointer
  file of message ids is kept, see CLAUDE.md). If you publish a policy,
  host a short page saying that and set its URL in BotFather. Not required.
- Group privacy: this bot only posts to a channel and answers /start in DM,
  so you can leave group privacy ON (the default).
