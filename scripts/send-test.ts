/**
 * Manual dev sender (NOT used by the running bot). Fires every schedule
 * once via the same runSchedule the cron uses, in schedules.ts order
 * (which mirrors a real day), then exits — so you preview exactly what
 * subscribers see.
 *
 * Re-running cleans up the previous run's azkar/poll posts. The opening
 * banner is sent OUTSIDE that tracking, so banners persist as session
 * markers — delete them by hand when done.
 *
 * Cleanup is per-machine: the pointer file (data/last-message-ids.json)
 * is local, so a test from your laptop and a prod cron fire don't see
 * each other's posts. Clean cross-machine leftovers by hand.
 *
 * Run: `pnpm send-test`. Needs `.env` (BOT_TOKEN + CHANNEL_CHAT_ID) and
 * the bot to be a channel admin with "Post messages" + "Delete messages".
 */
import { Bot, type Context } from 'grammy';
import { initState, post } from 'telegram-broadcast-kit';
import { config } from '../src/config';
import { initFileCache } from '../src/lib/fileCache';
import { runSchedule } from '../src/scheduler';
import { schedules } from '../src/schedules';

const bot = new Bot<Context>(config.botToken);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Same init as the real entry point, so cleanup has memory across runs and
  // the card file_id cache behaves exactly like production (upload once, then
  // resend by file_id).
  await initState(config.stateFilePath);
  await initFileCache(config.fileIdCachePath);

  // Preflight in one call so a bad token / wrong chat id / invite-link
  // slug fails with one clean diagnostic, not N identical 400s.
  try {
    await bot.api.getChat(config.channelChatId);
  } catch (err) {
    console.error('Preflight failed: cannot reach channel', config.channelChatId);
    console.error(
      '  CHANNEL_CHAT_ID must be numeric (e.g. -1001234567890) or @username — NOT an invite-link slug (+abc...).',
    );
    console.error('  Also check BOT_TOKEN is valid and the bot is a member of the channel.');
    console.error('  Underlying:', String(err));
    process.exit(1);
  }

  console.log('Sending test content to', config.channelChatId);

  // Session banner, sent directly (not via runSchedule) so it isn't
  // tracked or auto-deleted — it marks this preview session in the
  // scrollback. Old banners pile up by design; delete by hand.
  const bannerId = await post(
    bot,
    config.channelChatId,
    '🧪 رسائل اختبار للبوت، يمكنك حذفها بعد المعاينة.',
    { name: 'test-banner' },
  );
  if (bannerId === null) {
    console.error('Banner send failed — aborting. Check bot admin rights (Post messages).');
    process.exit(1);
  }
  console.log(`  test-banner: message ${bannerId}`);
  await sleep(1500);

  // Bail on the first failure; once one post succeeds the channel is
  // proven postable, so later failures are reported but don't halt.
  let postedAtLeastOne = false;
  for (const def of schedules) {
    const id = await runSchedule(bot, def);
    console.log(`  ${def.name}: ${id === null ? 'FAILED' : 'message ' + id}`);
    if (id === null) {
      if (!postedAtLeastOne) {
        console.error('First fire failed — aborting. Check bot admin rights (Post messages).');
        process.exit(1);
      }
    } else {
      postedAtLeastOne = true;
    }
    await sleep(1500);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test send failed:', err);
  process.exit(1);
});
