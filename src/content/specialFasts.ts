import { config } from '../config';
import { hijriDate } from '../lib/hijri';

/**
 * Season-bound voluntary-fast reminders, beyond the weekly Mon/Thu nudge:
 * عاشوراء/تاسوعاء، يوم عرفة، ستّ من شوّال، والأيّام البيض. ONE announcement per
 * occasion, fired a day or two AHEAD on the eve of the occasion (see
 * specialFastReminder), so the reader has time to plan السحور and عقد النيّة.
 *
 * FRAMING — a window, NOT a hard "tomorrow" (the deliberate design choice for a
 * global audience):
 *   The bot broadcasts to ONE channel read worldwide, and it computes the Hijri
 *   date from the *calculated* Umm al-Qura table in config.timezone. A reader's
 *   local crescent sighting can differ from that table by ±1 day, so a flat
 *   "صُم غدًا" would be wrong for many. Instead each message:
 *     • states the Umm al-Qura date «بتوقيت القناة» as guidance, and
 *     • tells the reader to follow their OWN country's announcement, and
 *     • for عاشوراء (the differ-from-the-Jews fast) leans into the very
 *       uncertainty by recommending صيام ٩-١٠-١١ — which is at once the MOST
 *       COMPLETE level (Ibn al-Qayyim) AND the safe hedge Imam Ahmad gave for
 *       when the start of the month is uncertain. The bot's weakness (it can't
 *       know each reader's local date) becomes the message's content.
 *
 * تحقيق (every marfūʿ text sahih/hasan; sources in the comment above each):
 *   • «صيامُ يومِ عاشوراءَ أحتسبُ على اللهِ أن يُكفّرَ السنةَ التي قبلَه»: مسلم
 *     (١١٦٢) من حديث أبي قتادة.
 *   • «لئن بقيتُ إلى قابلٍ لأصومنّ التاسع»: مسلم (١١٣٤) من حديث ابن عباس — أصلُ
 *     استحباب صيام التاسوعاء مع العاشوراء، مخالفةً لأهل الكتاب.
 *   • «صيامُ يومِ عرفةَ أحتسبُ على اللهِ أن يُكفّرَ السنةَ التي قبلَه والسنةَ التي
 *     بعدَه»: مسلم (١١٦٢) من حديث أبي قتادة — في حقّ غير الحاجّ.
 *   • «ما من أيّامٍ العملُ الصالحُ فيها أحبُّ إلى اللهِ من هذه الأيّامِ العشر»:
 *     البخاري (٩٦٩) من حديث ابن عباس (بلفظ «فيها»، لا «فيهنّ»).
 *   • «من صام رمضانَ ثمّ أتبعَه ستًّا من شوّالٍ كان كصيامِ الدهر»: مسلم (١١٦٤)
 *     من حديث أبي أيوب.
 *   • «صيامُ ثلاثةِ أيّامٍ من كلِّ شهرٍ صيامُ الدهر، وأيّامُ البيضِ صبيحةَ ثلاثَ
 *     عشرةَ وأربعَ عشرةَ وخمسَ عشرة»: النسائي من حديث جرير بن عبد الله، حسّنه
 *     الألباني (صحيح النسائي). وأصلُ صيام ثلاثةٍ من كلِّ شهرٍ متّفقٌ عليه.
 *
 * ⚠️ كلُّ ما سبق [راجعه طالب علم] — تبقى مراجعة طالب علم موثوق مرّةً واحدة هي
 *    الضمان الأخير، كبقيّة محتوى src/content/.
 */

const ASHURA_REMINDER = `🌙 عاشوراء على الأبواب

عاشوراء (العاشر من محرّم) يومٌ عظيم، صامه النبيُّ ﷺ وقال: «صيامُ يومِ عاشوراءَ أحتسبُ على اللهِ أن يُكفّرَ السنةَ التي قبلَه» (رواه مسلم) — أي يُكفّر صغائرَ سنةٍ كاملة.

والسنّة أن تصوم معه يومًا قبله (التاسوعاء، التاسع)؛ قال ﷺ: «لئن بقيتُ إلى قابلٍ لأصومنّ التاسع» (رواه مسلم)، مخالفةً لليهود.

🗓️ بحسب تقويم أمّ القرى (بتوقيت القناة): التاسوعاء ٩ محرّم، وعاشوراء ١٠ محرّم. وتختلف رؤية الهلال بين البلدان، فاعتمد إعلانَ بلدك أنت.

✅ والأكمل أن تصوم التاسع والعاشر معًا. وإن لم تتيقّن من بداية الشهر عندك فصُم ٩ و ١٠ و ١١ احتياطًا، حتى تُدركَ العاشرَ بيقين (وهو ما أرشد إليه الإمام أحمد عند اشتباه أوّل الشهر).

ومن لم يتيسّر له إلا العاشرُ وحده فله أجرُ عاشوراء بإذن الله 🤍`;

const ARAFAH_REMINDER = `🌄 عشرُ ذي الحجة وعرفةُ قد أقبلت

نحن في أفضلِ أيّام الدنيا؛ قال ﷺ: «ما من أيّامٍ العملُ الصالحُ فيها أحبُّ إلى اللهِ من هذه الأيّامِ العشر» (رواه البخاري) — فأكثِر من الصيام والذكر والتكبير والصدقة.

وأعظمُها يومُ عرفة (التاسع من ذي الحجة) لغير الحاجّ؛ قال ﷺ: «صيامُ يومِ عرفةَ أحتسبُ على اللهِ أن يُكفّرَ السنةَ التي قبلَه والسنةَ التي بعدَه» (رواه مسلم) — سنتان كاملتان.

🗓️ بحسب تقويم أمّ القرى (بتوقيت القناة): عرفةُ ٩ ذي الحجة، ثم عيدُ الأضحى ١٠ (لا صيام فيه). وتختلف الرؤية بين البلدان، فاعتمد إعلانَ بلدك في تحديد عرفةَ والعيد.

✅ صُم عرفةَ ولو لم تصم بقيّةَ العشر؛ ومن صام العشرَ كلَّها (إلا يومَ العيد) فقد جمع خيرًا كثيرًا 🤍`;

const SITT_SHAWWAL_REMINDER = `🌙 ستٌّ من شوّال: أجرُ صيامِ الدهر

تقبّل اللهُ منّا ومنكم 🤍 ومن سننِ هذا الشهر صيامُ ستّةِ أيّامٍ من شوّال؛ قال ﷺ: «من صام رمضانَ ثمّ أتبعَه ستًّا من شوّالٍ كان كصيامِ الدهر» (رواه مسلم).

✅ تصومها متتابعةً أو متفرّقةً، في أيّ يومٍ من الشهر بعد العيد، ولو يومًا في كلّ أسبوع — فالأمرُ واسع.

• ومن كان عليه قضاءٌ من رمضان فالأَولى أن يبدأ بالقضاء أوّلًا.
• ولا صيامَ يومَ العيد؛ يبدأ الفضلُ من الغد بإذن الله 🤍`;

const AYYAM_BID_REMINDER = `🌕 الأيّامُ البيض: سنّةٌ في كلّ شهر

من السنّة صيامُ ثلاثةِ أيّامٍ من كلّ شهرٍ هجري، وأفضلُها «الأيّامُ البيض»: الثالثَ عشرَ والرابعَ عشرَ والخامسَ عشر. قال ﷺ: «صيامُ ثلاثةِ أيّامٍ من كلِّ شهرٍ صيامُ الدهر، وأيّامُ البيضِ: صبيحةَ ثلاثَ عشرةَ وأربعَ عشرةَ وخمسَ عشرة» (رواه النسائي وحسّنه الألباني) — فالحسنةُ بعشرِ أمثالها.

🗓️ تبدأ غدًا بإذن الله (١٣ من الشهر بتوقيت القناة). واعتمد تقويمَ بلدك في تحديد أوّل الشهر.

✅ وإن فاتك البيضُ فلك أن تصومَ أيَّ ثلاثةِ أيّامٍ من الشهر؛ فالعبرةُ بثلاثةٍ في الشهر، والبيضُ أفضلُها 🤍`;

/**
 * The special-fast announcement for tonight, or null on an ordinary night.
 *
 * Keyed off TODAY's Umm al-Qura date in `tz` (the eve of the occasion):
 *   • محرّم ٨        → the عاشوراء/تاسوعاء window (covers both ٩ and ١٠).
 *   • ذو الحجة ٧     → the عشر + عرفة announcement (٢ days before عرفة).
 *   • شوّال ١        → ستّ من شوّال (Eid al-Fitr night; the month-long window).
 *   • day ١٢ of a
 *     month (not ٩
 *     رمضان / ١٢ ذو
 *     الحجة)        → the أيّام البيض (tomorrow is the ١٣th).
 *
 * Pure + tz-keyed (same discipline as isPollNight / noFastReason): a given
 * civil date always yields the same result, so it needs no saved state and is
 * restart-safe. Wired as both the `content` factory and the `skipIf` guard of
 * the special_fast_reminder schedule (skip when this is null), so the date
 * logic lives in exactly one place. Defaults to now + config.timezone, so the
 * scheduler calls it with no args; the args exist for tests.
 */
export function specialFastReminder(
  now: Date = new Date(),
  tz: string = config.timezone,
): string | null {
  const { month, day } = hijriDate(now, tz);

  if (month === 1 && day === 8) return ASHURA_REMINDER; // eve of the عاشوراء window
  if (month === 12 && day === 7) return ARAFAH_REMINDER; // 2 nights before عرفة
  if (month === 10 && day === 1) return SITT_SHAWWAL_REMINDER; // عيد الفطر night
  if (day === 12 && month !== 9 && month !== 12) return AYYAM_BID_REMINDER; // eve of the 13th
  return null;
}
