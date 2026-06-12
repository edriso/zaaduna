import { describe, it, expect } from 'vitest';
import { escapeHtml, azkarHtml, renderedText } from './format';
import { morningAzkar } from './morningAzkar';
import { eveningAzkar } from './eveningAzkar';
import { preSleepReminder } from './preSleep';

describe('escapeHtml', () => {
  it('escapes the three HTML-special characters', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('escapes & before < and > so entities are not double-escaped', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves Arabic, guillemets, braces and parens untouched', () => {
    const s = 'قال: «اللهم» {الإخلاص} (ثلاث مرّات)';
    expect(escapeHtml(s)).toBe(s);
  });
});

describe('renderedText', () => {
  it('strips the bold + blockquote tags and decodes entities (round-trips azkarHtml back to plain)', () => {
    const plain = 'X\n\nintro\n\n١. a\n٢. b\n\nfooter';
    expect(renderedText(azkarHtml(plain))).toBe(plain);
  });

  it('is a no-op on plain text with no tags or entities', () => {
    const plain = 'سنن الجمعة\n\nاقرأ الكهف';
    expect(renderedText(plain)).toBe(plain);
  });
});

describe('azkarHtml structure', () => {
  const cases = [
    { name: 'morning', plain: morningAzkar },
    { name: 'evening', plain: eveningAzkar },
    { name: 'preSleep', plain: preSleepReminder },
  ];

  for (const { name, plain } of cases) {
    describe(name, () => {
      const html = azkarHtml(plain);

      it('opens with a bold title and bolds only the first line', () => {
        expect(html.startsWith('<b>')).toBe(true);
        expect((html.match(/<b>/g) ?? []).length).toBe(1);
        expect((html.match(/<\/b>/g) ?? []).length).toBe(1);
        // The bold closes before the first newline (title is one line).
        expect(html.indexOf('</b>')).toBeLessThan(html.indexOf('\n'));
      });

      it('collapses the long dua list into one expandable blockquote (title + intro stay outside)', () => {
        expect((html.match(/<blockquote expandable>/g) ?? []).length).toBe(1);
        expect((html.match(/<\/blockquote>/g) ?? []).length).toBe(1);
        // The blockquote opens AFTER the bold title (the hook stays outside it).
        expect(html.indexOf('<blockquote expandable>')).toBeGreaterThan(html.indexOf('</b>'));
        // ...and it is the last thing in the message (the list runs to the end).
        expect(html.trimEnd().endsWith('</blockquote>')).toBe(true);
      });

      it('contains no raw < > & outside the tags we add (would 400 a parse)', () => {
        expect(renderedText(html)).not.toMatch(/[<>&]/);
      });

      it('rendered text equals the plain source (only the bold title added)', () => {
        expect(renderedText(html)).toBe(plain.trim());
      });
    });
  }
});
