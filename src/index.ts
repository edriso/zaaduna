import { config } from './config';
import { bot, setBotProfile } from './bot';
import { startScheduler, stopScheduler } from './scheduler';
import { startHealthServer, logger, initState } from 'telegram-broadcast-kit';
import { initFileCache } from './lib/fileCache';

async function main() {
  logger.info('Channel bot starting...', {
    timezone: config.timezone,
    isDev: config.isDev,
    channelChatId: config.channelChatId,
  });

  // Load the pointer file before the scheduler so the first fire already
  // knows which previous message (if any) to delete.
  await initState(config.stateFilePath);
  // Load the card file_id cache too, so the first fire can resend cards by
  // file_id (no re-upload) instead of re-uploading from disk.
  await initFileCache(config.fileIdCachePath);

  await setBotProfile();
  startScheduler(bot);
  startHealthServer();

  // Not awaited: bot.start() resolves only when polling stops. On a normal
  // shutdown bot.stop() resolves it cleanly; on a startup failure (e.g. a bad
  // token) it REJECTS, and because main() has already returned that rejection
  // would escape main().catch below. Attach a catch so a polling failure still
  // hits the "let it crash" path (log + exit so the supervisor restarts)
  // instead of leaving the process half-up (crons firing, no Telegram).
  bot
    .start({
      onStart: () => {
        logger.info('Bot is running. Press Ctrl+C to stop.');
      },
    })
    .catch((err) => {
      if (shuttingDown) return; // a stop() during shutdown is expected
      logger.error('Bot polling stopped unexpectedly', { error: String(err) });
      process.exit(1);
    });
}

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return; // a second signal must not race the first
  shuttingDown = true;
  logger.info(`${signal} received, shutting down...`);
  stopScheduler();

  // Await bot.stop() so an in-flight update isn't cut off, but cap the
  // wait so a stuck network call can't hang shutdown forever.
  try {
    await Promise.race([bot.stop(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  } catch (err) {
    logger.error('Error while stopping the bot', { error: String(err) });
  }
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async (err) => {
  logger.error('Fatal error', { error: String(err) });
  // Delay before exit so a misconfigured deploy doesn't spin a tight
  // restart loop on platforms that restart immediately.
  await new Promise((r) => setTimeout(r, 30_000));
  process.exit(1);
});
