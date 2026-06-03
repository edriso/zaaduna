import { morningAzkar } from './content/morningAzkar';
import { eveningAzkar } from './content/eveningAzkar';
import { preSleepReminder } from './content/preSleep';
import { fridaySunnah } from './content/fridaySunnah';
import { fastingReminder } from './content/fasting';
import { buildNightReviewPoll } from './content/poll';
import { azkarHtml } from './content/format';
import { fastForbiddenTomorrow } from './lib/hijri';
import { config } from './config';
import type { ScheduleDef } from './types';

export type { ScheduleDef } from './types';

/**
 * THE FILE TO EDIT. Each entry is one cron rule + what to post:
 *   kind: 'message' → text (fixed string, or random from an array)
 *   kind: 'poll'    → the anonymous self-review poll
 *
 * `cron` is a 5-field expression in TZ_NAME (default Africa/Cairo).
 * Day-of-week: 0/7=Sun, 1=Mon, ..., 5=Fri, 6=Sat.
 *
 * Keep times ≥ 02:00: Cairo springs 00:00→01:00 on the last Friday of
 * April and node-cron silently drops jobs in that missing hour.
 *
 * Cadence is deliberately calm — what hurts retention is the number of
 * separate notification moments, not the message count. Related posts
 * are co-scheduled a minute apart into one "session", and the rider posts
 * carry `silent: true` (Telegram disable_notification) so each session
 * rings exactly once: a morning ping (morning azkar), an evening ping
 * (evening azkar), and a bedtime ping (the night poll). That is ≤3
 * interruptions a day; the Friday/fasting riders still arrive, just
 * without a buzz.
 *
 * In the bedtime window the poll fires LAST (fasting → pre-sleep → poll),
 * so it sits newest at the bottom; its last option «سورة المُلك وأذكار
 * النوم» points the reader up to the pre-sleep message to act on. The poll
 * is the one audible bedtime post, so the single ping lands on it.
 */
export const schedules: ScheduleDef[] = [
  {
    name: 'morning_azkar',
    kind: 'message',
    // 05:30 Cairo: inside the Fajr→sunrise window all year (sunrise
    // swings ~5:55 June to ~6:45 December). 06:00 drifts past it in summer.
    cron: '30 5 * * *',
    // HTML only for a bold title; body stays normal-size text. azkarHtml
    // escapes the text; see content/format.ts.
    content: azkarHtml(morningAzkar),
    parseMode: 'HTML',
    description: 'أذكار الصباح، كل يوم 5:30 ص (داخل وقت الذكر بين الفجر وطلوع الشمس طوال السنة).',
  },
  {
    name: 'friday_sunnah',
    kind: 'message',
    // 05:32 Cairo, 2 min after morning_azkar (one morning ping). Exact
    // time is forgiving; what matters is bundling with the morning azkar.
    cron: '32 5 * * 5',
    content: fridaySunnah,
    // One-tap link to read the sura the message urges (السنة قراءتها يوم
    // الجمعة). The bot references Quran, never reproduces it — the button
    // is that reference made tappable.
    buttons: [[{ text: '📖 اقرأ سورة الكهف', url: 'https://quran.com/18?readingMode=arabic' }]],
    // Silent: rides 2 min after morning_azkar, so Friday still gets just
    // the one morning ping.
    silent: true,
    description:
      'سننُ الجمعة (الطهارة والزينة، التبكير، الكهف، الصلاة على النبي)، الجمعة 5:32 ص (صامت، مع أذكار الصباح).',
  },
  {
    name: 'evening_azkar',
    kind: 'message',
    // 17:00 Cairo: best read between Asr and Maghrib, but the window is
    // broad (Ibn Baz / Ibn Uthaymin allow after Maghrib too). 17:00 stays
    // valid year-round; don't move it to 16:30 — that falls before Asr in
    // summer (Cairo Asr reaches ~17:00 at the solstice).
    cron: '0 17 * * *',
    // HTML bold title, same as morning_azkar.
    content: azkarHtml(eveningAzkar),
    parseMode: 'HTML',
    description: 'أذكار المساء، كل يوم 5:00 م. الأفضل قراءتها بين العصر والمغرب.',
  },
  {
    name: 'fasting_reminder',
    kind: 'message',
    cron: '40 21 * * 0,3',
    content: fastingReminder,
    // Skip the nudge when TOMORROW (the fast day) is one nafl fasting is
    // forbidden — Eid or أيام التشريق. Narrow/asymmetric so يوم عرفة is
    // never suppressed; see lib/hijri.ts.
    skipIf: (now) => fastForbiddenTomorrow(now, config.timezone),
    // Silent: part of the bedtime session; the night poll carries its ping.
    silent: true,
    description:
      'تذكير صيام الإثنين/الخميس، مساء الأحد والأربعاء 9:40 م (صامت، مع مجموعة ما قبل النوم). يُتخطّى تلقائيًّا إن كان الغد عيدًا أو من أيّام التشريق.',
  },
  {
    name: 'pre_sleep',
    kind: 'message',
    cron: '43 21 * * *',
    // HTML bold title, same as morning_azkar.
    content: azkarHtml(preSleepReminder),
    parseMode: 'HTML',
    // One-tap links to the suras this message names. Quran is referenced,
    // not reproduced — these buttons are the reference. المُلك on its own row
    // (most emphasised: تشفع لصاحبها). الكافرون is omitted on purpose: it is
    // short and universally memorised, so a link adds nothing.
    buttons: [
      [{ text: '📖 سورة المُلك', url: 'https://quran.com/67?readingMode=arabic' }],
      [{ text: 'سورة السجدة', url: 'https://quran.com/32?readingMode=arabic' }],
    ],
    // Silent: part of the bedtime session; the night poll (9:45) carries
    // the single bedtime ping and sits just below this message.
    silent: true,
    description:
      'سورة المُلك وأذكار النوم ونيّة القيام، كل يوم 9:43 م (صامت، قبل استبيان المراجعة بدقيقتين).',
  },
  {
    name: 'night_review_poll',
    kind: 'poll',
    cron: '45 21 * * *',
    // Factory, rebuilt each fire so Mon/Thu nights add a fasting option
    // (see poll.ts), while one schedule + one state key keeps cleanup simple.
    poll: () => buildNightReviewPoll(),
    // Opts the poll into replace-on-next-fire (polls default to 0 =
    // untracked), so exactly one live poll shows — no stack of identical
    // questions burying the pinned welcome.
    keepLast: 1,
    description:
      'استبيان مراجعة الليلة (مجهول)، كل يوم 9:45 م — آخر منشور في النافذة، يدلّ المُتَخَلِّف عن ذكرٍ إلى رسالة ما قبل النوم فوقَه. تُحذَف نسخة الليلة السابقة عند نشر الجديدة.',
  },
];

/** Lookup helper used by /admin_run. */
export function findSchedule(name: string): ScheduleDef | undefined {
  return schedules.find((s) => s.name === name);
}
