/**
 * Manual welcome updater (NOT used by the cron loop). The welcome text
 * lives in src/content/welcome.ts; edit it, then run this to push it.
 *
 *   pnpm post-welcome              → post a NEW message (first setup);
 *                                    pin it by hand and keep the id.
 *   pnpm post-welcome <message_id> → edit that message in place (pin
 *                                    stays, no notification). Only works
 *                                    on a message this bot sent itself.
 *
 * Pinning stays manual on purpose: re-pinning fires a notification every
 * time, so edit-in-place keeps updates silent. Preflights with getChat()
 * to fail fast on a bad token / chat id.
 */
import { Bot, type Context } from 'grammy';
import { post } from 'telegram-broadcast-kit';
import { config } from '../src/config';
import { welcomeMessage } from '../src/content/welcome';

const bot = new Bot<Context>(config.botToken);
const messageIdArg = process.argv[2];

async function main() {
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

  if (messageIdArg) {
    const messageId = Number(messageIdArg);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      console.error(`Invalid message_id: "${messageIdArg}". Pass a positive integer.`);
      process.exit(1);
    }
    try {
      await bot.api.editMessageText(config.channelChatId, messageId, welcomeMessage);
      console.log(`Edited welcome message ${messageId} in ${config.channelChatId}.`);
      console.log('The pin (if any) stayed; no notification fired.');
    } catch (err) {
      console.error('Edit failed:', String(err));
      console.error(
        '  The bot can only edit messages it sent itself. If the original welcome was posted',
      );
      console.error(
        '  by a different account (or before this script existed), run with no args to post',
      );
      console.error('  a new one, then re-pin and remember the new message_id.');
      process.exit(1);
    }
  } else {
    const id = await post(bot, config.channelChatId, welcomeMessage, { name: 'welcome' });
    if (id === null) {
      console.error('Post failed. Check bot admin rights (Post messages).');
      process.exit(1);
    }
    console.log(`Posted welcome to ${config.channelChatId} as message ${id}.`);
    console.log('Next: pin this message in the channel (⋮ → Pin).');
    console.log(`To update later without re-pinning: pnpm post-welcome ${id}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Welcome script failed:', err);
  process.exit(1);
});
