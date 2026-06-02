import { Bot, Context } from 'grammy';
import { logger } from 'telegram-broadcast-kit';
import { config } from './config';
import { botAbout, botDescription } from './content/profile';
import { schedules, findSchedule } from './schedules';
import { runSchedule } from './scheduler';

const bot = new Bot<Context>(config.botToken);

/**
 * Gate for /admin_* commands: true only for a DM from the configured
 * admin. The private-chat check stops the commands firing (and leaking
 * channel internals) in any group the bot is in. No admin id → no-op.
 */
function isAdmin(ctx: Context): boolean {
  if (config.adminTelegramId === null) return false;
  if (ctx.chat?.type !== 'private') return false;
  return ctx.from ? BigInt(ctx.from.id) === config.adminTelegramId : false;
}

/** Plain-text list of every schedule name, for the /admin_run hints. */
function scheduleNameList(): string {
  return schedules.map((s) => `  - ${s.name}`).join('\n');
}

// /start in DM: the bot is channel-first, so this just explains itself.
bot.command('start', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const link = config.channelUrl;
  await ctx.reply(
    'السلام عليكم 🌿\n' +
      'هذا بوت تذكيرٍ يومي ينشر في قناته المحدّدة فقط (أذكار ومراجعة الليلة).\n' +
      'لا يوجد ما تتفاعل معه هنا، تابِع القناة لتصلك التذكيرات بإذن الله.' +
      '\n\n' +
      'This bot only posts on a schedule to its channel. Nothing to do here.' +
      // One link after both language blocks (a URL needs no translation).
      (link ? `\n\n📢 ${link}` : ''),
  );
});

// /admin_health: an "is it up?" snapshot in DM. Plain text (no
// parse_mode), same reason as the channel posts.
bot.command('admin_health', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const uptime = Math.floor(process.uptime());
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  let now: string;
  try {
    now = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date());
  } catch {
    now = `${new Date().toISOString()} (UTC; TZ_NAME invalid)`;
  }

  const lines = [
    'Health',
    '------',
    `Uptime: ${days}d ${hours}h ${mins}m`,
    `Now: ${now} (${config.timezone})`,
    `Channel: ${config.channelChatId}${config.channelUrl ? ` (${config.channelUrl})` : ''}`,
    `Schedules registered: ${schedules.length}`,
  ];
  for (const s of schedules) {
    lines.push(`  - ${s.name} [${s.kind}] (${s.cron})`);
  }
  await ctx.reply(lines.join('\n'));
});

// /admin_run <name>: manually fire one schedule via the same path the
// cron uses (a real end-to-end test). A null result means "nothing
// posted" — empty content or a failed send — so the reply says both.
bot.command('admin_run', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const raw = ctx.message?.text ?? '';
  const name = raw.replace(/^\/admin_run(@\S+)?\s*/, '').trim();
  if (!name) {
    await ctx.reply(`Usage: /admin_run <schedule-name>\n\nSchedules:\n${scheduleNameList()}`);
    return;
  }
  const def = findSchedule(name);
  if (!def) {
    await ctx.reply(`Unknown schedule: ${name}\n\nSchedules:\n${scheduleNameList()}`);
    return;
  }
  try {
    const messageId = await runSchedule(bot, def);
    if (messageId === null) {
      await ctx.reply(
        `"${name}" did not post.\n` +
          'Either its content was empty, or the Telegram send failed — ' +
          'most often the bot is not a channel admin with the "Post ' +
          'messages" permission. Check the process logs for the exact error.',
      );
    } else {
      await ctx.reply(`Posted "${name}" to the channel (message ${messageId}).`);
    }
  } catch (err) {
    logger.error('admin_run threw', { name, error: String(err) });
    await ctx.reply(`"${name}" threw an unexpected error: ${String(err)}`);
  }
});

bot.catch((err) => {
  logger.error('Bot error', { error: String(err.error), update: err.ctx.update.update_id });
});

async function setBotProfile() {
  await bot.api.setMyCommands([{ command: 'start', description: 'About this bot' }]);
  // Set the About (short description) and Description the same way as the
  // commands, so the bot is self-describing on deploy — no manual @BotFather
  // step. The texts live in src/content/profile.ts (verbatim from
  // docs/BOTFATHER.md) and stay within Telegram's 120 / 512 char limits.
  await bot.api.setMyShortDescription(botAbout);
  await bot.api.setMyDescription(botDescription);
}

export { bot, setBotProfile };
