/**
 * HTML formatting for the long azkar messages.
 *
 * The three azkar posts (morning / evening / pre-sleep) are long lists of
 * du'a. They are sent with parse_mode 'HTML' for ONE small touch: a BOLD
 * title line. The body stays normal-size plain text.
 *
 * Why not an expandable blockquote (which would collapse the long list in
 * the feed): Telegram renders blockquote text in a smaller, condensed font,
 * and the Bot API has no font-size control. Normal-size, readable du'a beats
 * a tidy-but-tiny collapsed block, so we keep the list at full size. The
 * Arabic-Indic numbering (١. ٢. ٣.) carries the readability instead.
 *
 * Two facts make the bold title safe and cheap:
 *   - HTML tags do NOT count toward Telegram's 4096-char message limit (the
 *     limit is on the rendered text), so the <b> tags are free.
 *   - In HTML mode only & < > are special. The Arabic du'a/Quran text has
 *     none of them, and we still run every part through escapeHtml so a
 *     future edit that adds one can never 400 the send.
 *
 * This is the ONE deliberate carve-out from the project's "no parse_mode"
 * rule (see CLAUDE.md), scoped to these three schedules. Everything else
 * (friday sunnah, fasting nudge, the poll) stays plain text.
 */

/** Escape the three characters that are special in Telegram HTML mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Turn a plain azkar message into HTML: bold the title (the first line),
 * leave the rest as normal-size text. The plain text is the source of truth
 * (kept byte-exact in src/content/*); this only adds the <b> wrapper and
 * escapes & < >.
 */
export function azkarHtml(plain: string): string {
  const trimmed = plain.trim();
  const nl = trimmed.indexOf('\n');
  const title = nl === -1 ? trimmed : trimmed.slice(0, nl);
  const rest = nl === -1 ? '' : trimmed.slice(nl); // keeps the leading newlines
  return `<b>${escapeHtml(title)}</b>${escapeHtml(rest)}`;
}

/**
 * The text Telegram actually displays (and counts toward the 4096 limit):
 * the HTML with our tags stripped and entities decoded. Used by the tests
 * to check the rendered length, and safe to call on plain text (a no-op).
 */
export function renderedText(html: string): string {
  return html
    .replace(/<\/?b>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
