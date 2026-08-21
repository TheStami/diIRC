import { visit } from "unist-util-visit";
type Root = any;
type Text = any;
type Parent = any;

// Helper to create mdast nodes with custom data for hast conversion
function createSpoilerNode(children: any[]) {
  return {
    type: "spoiler",
    children,
    data: {
      hName: "spoiler",
      hProperties: {},
    },
  } as any;
}

function createUnderlineNode(children: any[]) {
  return {
    type: "underline",
    children,
    data: {
      hName: "underline",
      hProperties: {},
    },
  } as any;
}

/**
 * Remark plugin for `||spoiler||` syntax.
 * Converts ||text|| inside text nodes to <spoiler> nodes.
 * Runs before GFM so it captures raw pipes.
 */
export function remarkSpoiler() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      // Quick check
      if (!value.includes("||")) return;
      // Don't process inside code/inlineCode
      if (parent.type === "inlineCode" || parent.type === "code") return;

      const regex = /\|\|(.+?)\|\|/g;
      let match: RegExpExecArray | null;
      let lastIndex = 0;
      const newNodes: any[] = [];
      let hasSpoiler = false;

      while ((match = regex.exec(value)) !== null) {
        hasSpoiler = true;
        const before = value.slice(lastIndex, match.index);
        if (before) newNodes.push({ type: "text", value: before });
        const inner = match[1];
        // Create text node inside spoiler — further markdown inside spoiler not parsed for MVP simplicity
        // But allow bold etc inside spoiler by creating text that will be re-parsed? For now plain text.
        newNodes.push(createSpoilerNode([{ type: "text", value: inner }]));
        lastIndex = match.index + match[0].length;
      }

      if (!hasSpoiler) return;

      const after = value.slice(lastIndex);
      if (after) newNodes.push({ type: "text", value: after });

      // Replace current node with new nodes
      parent.children.splice(index, 1, ...newNodes);
      // Need to re-visit? return index to handle next nodes
      return index + newNodes.length;
    });
  };
}

/**
 * Remark plugin for `__underline__` syntax (Discord style).
 * Converts __text__ to <underline> nodes.
 * Note: GFM also treats __text__ as strong when len=2. This plugin runs *before* GFM parsing,
 * but mdast text still contains __. We need to ensure GFM doesn't double-parse.
 * Approach: split text nodes on __...__ before GFM's strong handling would, by running at text level
 * and creating underline nodes that GFM will leave alone.
 * 
 * To avoid conflict where __text__ should be underline not bold, we consume __...__ here.
 * **bold** uses **, so __ remains free for underline.
 */
export function remarkUnderline() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      if (!value.includes("__")) return;
      if (parent.type === "inlineCode" || parent.type === "code") return;
      // Avoid inside links/images? Allow but simple.
      // Regex for __underline__ : double underscore, not triple, not empty, no newline
      const regex = /__([^_\n]+?)__/g;
      let match: RegExpExecArray | null;
      let lastIndex = 0;
      const newNodes: any[] = [];
      let hasUnderline = false;

      while ((match = regex.exec(value)) !== null) {
        // Avoid matching four underscores ____ (empty) or overlapping with *** etc.
        // Ensure match not part of longer ____ sequence? simple check: char before/after not _
        const beforeChar = value[match.index - 1];
        const afterChar = value[match.index + match[0].length];
        if (beforeChar === "_" || afterChar === "_") continue;
        hasUnderline = true;
        const before = value.slice(lastIndex, match.index);
        if (before) newNodes.push({ type: "text", value: before });
        const inner = match[1];
        newNodes.push(createUnderlineNode([{ type: "text", value: inner }]));
        lastIndex = match.index + match[0].length;
      }

      if (!hasUnderline) return;
      const after = value.slice(lastIndex);
      if (after) newNodes.push({ type: "text", value: after });

      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
}
