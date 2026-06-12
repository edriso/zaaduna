/**
 * HTML formatting for the long azkar messages.
 *
 * The three azkar posts (morning / evening / pre-sleep) are long lists of
 * du'a (each ~3-4k chars). Sent flat, one of them is a screen-and-a-half
 * wall that dominates the channel feed. So azkarHtml gives them a
 * "partial expandable blockquote" shape:
 *
 *   <b>title</b>            ← full size, the readable hook
 *   intro paragraph         ← full size, still the hook
 *   <blockquote expandable> ← the long du'a list, COLLAPSED in the feed
 *     ١. ...                   ("Show more" expands it)
 *     ٢. ...
 *   </blockquote>
 *
 * Net: the feed shows a title + one intro line + a few preview lines + a
 * "Show more" tap, instead of a full wall. The reader who wants to recite
 * taps to expand. Why "partial" (title + intro OUTSIDE the quote): Telegram
 * renders blockquote text in a smaller, condensed font with no size control,
 * so we keep the hook at normal size and only the deliberately-expanded list
 * is in the smaller font. We tried a FULL expandable (everything quoted) and
 * a flat full-size list before; this is the middle ground.
 *
 * The split is content-agnostic: title = the first line, intro = the first
 * paragraph after it, body = everything from the second blank line on. All
 * three azkar files follow that shape (title / blank / intro / blank / list).
 *
 * Three facts make this safe and cheap:
 *   - HTML tags do NOT count toward Telegram's 4096-char message limit (the
 *     limit is on the rendered text), so the <b>/<blockquote> tags are free.
 *   - In HTML mode only & < > are special. The Arabic du'a/Quran text has
 *     none of them, and we still run every part through escapeHtml so a
 *     future edit that adds one can never 400 the send.
 *   - renderedText() strips our tags back to the byte-exact plain source, so
 *     the 4096 check measures exactly what Telegram renders.
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
 * Turn a plain azkar message into the partial-expandable HTML described in
 * the file header: bold title + full-size intro, then the long du'a list in
 * an expandable blockquote. The plain text stays the source of truth (kept
 * byte-exact in src/content/*); this only injects <b>/<blockquote> tags and
 * escapes & < >, so renderedText() round-trips it back exactly.
 *
 * Split points (both are blank-line breaks, the shape every azkar file uses):
 *   - title  = everything before the FIRST blank line.
 *   - intro  = the paragraph between the first and second blank lines.
 *   - body   = everything from the second blank line on → the blockquote.
 * If a file has no second blank line, the whole rest becomes the intro and no
 * blockquote is added (a safe degrade — it just renders flat with a bold
 * title, the old behaviour).
 */
export function azkarHtml(plain: string): string {
  const trimmed = plain.trim();

  const firstBreak = trimmed.indexOf('\n\n');
  if (firstBreak === -1) {
    // No paragraphs at all — bold the single line, nothing to collapse.
    return `<b>${escapeHtml(trimmed)}</b>`;
  }
  const title = trimmed.slice(0, firstBreak);
  const afterTitle = trimmed.slice(firstBreak + 2);

  const secondBreak = afterTitle.indexOf('\n\n');
  if (secondBreak === -1) {
    // Title + one paragraph, no long list — keep it flat (bold title only).
    return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(afterTitle)}`;
  }
  const intro = afterTitle.slice(0, secondBreak);
  const body = afterTitle.slice(secondBreak + 2);

  return (
    `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(intro)}\n\n` +
    `<blockquote expandable>${escapeHtml(body)}</blockquote>`
  );
}

/**
 * The text Telegram actually displays (and counts toward the 4096 limit):
 * the HTML with our tags stripped and entities decoded. Used by the tests
 * to check the rendered length, and safe to call on plain text (a no-op).
 */
export function renderedText(html: string): string {
  return html
    .replace(/<\/?b>/g, '')
    .replace(/<blockquote expandable>/g, '')
    .replace(/<\/blockquote>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
