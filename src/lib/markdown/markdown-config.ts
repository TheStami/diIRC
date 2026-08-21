type SanitizeOptions = any;

/**
 * Sanitize schema for Markdown rendering in diIRC.
 * - Allows common GFM markdown elements
 * - Disables tables (decyzja 3: Wyłącz)
 * - Allows custom `spoiler` and `underline` via span/u but mapped to React components
 * - Blocks dangerous protocols (javascript:, data: except image proxy which is handled separately)
 * - No raw HTML (rehype-raw not used)
 */

// Base allowed tags — common markdown without table
const baseTagNames = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "del",
  "s",
  "strike",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "hr",
  "span",
  "div",
  "input",
  "img",
  "spoiler", // custom — will be mapped to React component
  "underline", // custom
];

// Note: `rehype-sanitize` will strip unknown tags unless in schema, so we whitelist spoiler/underline
// but they will be rendered via ReactMarkdown components mapping.

export const markdownSanitizeSchema: SanitizeOptions = {
  tagNames: baseTagNames,
  attributes: {
    a: ["href", "title"],
    code: ["className"],
    pre: ["className"],
    span: ["className", "dataSpoiler"],
    div: ["className"],
    h1: ["className"],
    h2: ["className"],
    h3: ["className"],
    h4: ["className"],
    h5: ["className"],
    h6: ["className"],
    blockquote: ["className"],
    ul: ["className"],
    ol: ["className"],
    li: ["className"],
    p: ["className"],
    img: ["src", "alt", "title"],
    spoiler: ["className"],
    underline: ["className"],
    u: ["className"],
    input: ["type", "checked", "disabled", "className"],
    // allow className globally for Tailwind
    "*": ["className"],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  // strip unknown protocols like javascript:
  strip: ["script", "style"],
} as any;

export const markdownAllowedElements = baseTagNames;
