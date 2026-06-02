/**
 * The bot's public profile texts, set on startup via the Bot API (like the
 * command list) so the bot is self-describing on deploy — no manual @BotFather
 * step. Both are the verbatim copies of the "About" and "Description" blocks in
 * `docs/BOTFATHER.md`; keep the two in sync if either changes.
 *
 * Telegram limits: About (short description) ≤ 120 chars, Description ≤ 512.
 * Over-limit values 400 at runtime and crash startup, so do not exceed them.
 */

// About = the short blurb shown on the bot's profile card.
export const botAbout =
  '«زادُنا» 🌿 أذكار الصباح والمساء، سننُ الجمعة، أذكار النوم، واستبيانٌ سرّيٌّ لمراجعة الليلة. اضغط Start للقناة.';

// Description = the text on the empty chat, shown before the user presses Start.
export const botDescription = [
  '🌿 أهلًا بك في «زادُنا»',
  'قناةٌ هادئةٌ تُعينك على دوام ذكر الله، تنشر وِردًا يوميًّا في قناتها فقط:',
  '• 🌅 أذكار الصباح 5:30 ص',
  '• 🌇 أذكار المساء 5:00 م',
  '• 🕌 سننُ الجمعة (الجمعة)',
  '• 🌙 سورة المُلك وأذكار النوم 9:43 م',
  '• 📋 استبيانُ مراجعةِ الليلة 9:45 م (سرّيٌّ تمامًا)',
  'كل ليلة تختار ما أتممتَ من عملك، والتصويت مجهولٌ لا يرى أحدٌ اختيارك. لا حساب، ولا متابعة لأحد. اضغط Start لرابط القناة. (بتوقيت القاهرة)',
].join('\n');
