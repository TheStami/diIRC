/**
 * Utilities for Markdown handling — link extraction, trailing punctuation fix, etc.
 * Keeps compatibility with existing `image-utils.ts` and `link-preview.tsx` expectations.
 */

// Regex fragments similar to original but used for fallback when markdown disabled
export const urlRegexRaw = /(https?:\/\/[^\s]+)/g;

/**
 * Strips trailing punctuation that is often captured incorrectly: `)`, `]`, `.`, `,`, `!`, `?`, `"`, `'`
 * And handles balanced parentheses case: if URL contains `(` then keep one `)`.
 */
export function stripTrailingPunct(url: string): string {
  if (!url) return url;
  // Remove trailing punctuation iteratively
  let cleaned = url;
  // Common trailing chars that are not part of URL when at end
  // Keep `)` only if balanced
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if ([ ".", ",", "!", "?", ";", ":", "'", '"', "]"].includes(last)) {
      cleaned = cleaned.slice(0, -1);
      continue;
    }
    if (last === ")") {
      // Count '(' vs ')' inside cleaned
      const open = (cleaned.match(/\(/g) || []).length;
      const close = (cleaned.match(/\)/g) || []).length;
      // If more closing than opening, strip one
      if (close > open) {
        cleaned = cleaned.slice(0, -1);
        continue;
      }
      break;
    }
    break;
  }
  return cleaned;
}

/**
 * Extracts URLs from markdown AST-like rendering? For compatibility we provide fallback that extracts
 * from raw text but excludes code blocks/inline code.
 * 
 * Strategy: Remove code blocks (``` ... ```) and inline code (`...`) before regex, then match URLs
 * and clean punctuation.
 */
export function extractUrlsFromMarkdownText(text: string): string[] {
  if (!text) return [];
  // Remove ```code blocks```
  let stripped = text.replace(/```[\s\S]*?```/g, " ");
  // Remove `inline code`
  stripped = stripped.replace(/`[^`]*`/g, " ");
  // Also remove spoiler ||...|| content? Keep URL inside spoiler? For now extract but preview hidden until revealed.
  // We will still extract but LinkPreview will handle spoiler separately (not shown).
  const matches = stripped.match(urlRegexRaw) || [];
  const cleaned = matches.map(stripTrailingPunct).filter(Boolean);
  // Dedup
  return Array.from(new Set(cleaned));
}

/**
 * Checks if a markdown link href is safe (http/https/mailto only)
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    // Relative URLs not allowed in chat — treat as unsafe
    return false;
  }
}

/**
 * Simple helper to wrap selection in textarea for toolbar actions.
 */
export function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = "text"
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || placeholder;
  const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    newValue,
    newSelectionStart: start + before.length,
    newSelectionEnd: start + before.length + selected.length,
  };
}

/**
 * Detects if text contains any Markdown syntax that should trigger markdown rendering.
 * Used to make markdown "only when user adds markdown characters" — plain text without markers
 * renders via legacy plain path (no extra <p> etc.).
 */
export function hasMarkdownSyntax(text: string): boolean {
  if (!text) return false;
  // Quick checks for common markdown markers
  // Bold/italic/underline/strike: **, *, __, ~~
  if (/\*\*[^*]+\*\*/.test(text)) return true;
  if (/(^|[^*])\*[^*\n]+\*([^*]|$)/.test(text)) return true; // simple single * italic (avoid **)
  if (/__[^_\n]+__/.test(text)) return true;
  if (/~~[^~\n]+~~/.test(text)) return true;
  if (/\|\|[^|\n]+\|\|/.test(text)) return true;
  if (/`[^`\n]+`/.test(text)) return true;
  if (/```/.test(text)) return true;
  if (/^>\s/m.test(text)) return true; // blockquote at line start
  if (/^#{1,6}\s/m.test(text)) return true; // heading
  if (/^\s*[-*]\s/m.test(text)) return true; // unordered list
  if (/^\s*\d+\.\s/m.test(text)) return true; // ordered list
  if (/\[.+\]\(https?:\/\/[^\s]+\)/.test(text)) return true; // markdown link
  if (/^---\s*$/m.test(text) || /^___\s*$/m.test(text) || /^\*\*\*\s*$/m.test(text)) return true; // hr
  // Note: plain autolink https://... is handled by both paths, but we don't treat as markdown syntax
  // to avoid rendering plain URL via markdown when no other markers. LinkPreview will still work.
  return false;
}
