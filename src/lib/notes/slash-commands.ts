import type { TextNoteBlockType } from "./types";

export type SlashCommandId =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bulleted-list"
  | "numbered-list"
  | "to-do"
  | "quote"
  | "divider"
  | "code"
  | "page";

export type SlashCommandIcon =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bulleted-list"
  | "numbered-list"
  | "to-do"
  | "quote"
  | "divider"
  | "code"
  | "page";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  description: string;
  aliases: string[];
  icon: SlashCommandIcon;
  type?: TextNoteBlockType;
}

export const slashCommands: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    description: "Plain writing",
    aliases: ["paragraph", "body", "plain"],
    icon: "text",
    type: "paragraph",
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    aliases: ["h1", "title", "large heading"],
    icon: "heading-1",
    type: "heading_1",
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    aliases: ["h2", "subtitle", "medium heading"],
    icon: "heading-2",
    type: "heading_2",
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    aliases: ["h3", "small heading"],
    icon: "heading-3",
    type: "heading_3",
  },
  {
    id: "bulleted-list",
    label: "Bulleted list",
    description: "An unordered list item",
    aliases: ["bullet", "unordered", "ul", "list"],
    icon: "bulleted-list",
    type: "bulleted_list_item",
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    description: "An ordered list item",
    aliases: ["number", "ordered", "ol", "list"],
    icon: "numbered-list",
    type: "numbered_list_item",
  },
  {
    id: "to-do",
    label: "To-do",
    description: "A checkable task",
    aliases: ["todo", "task", "checkbox", "check"],
    icon: "to-do",
    type: "to_do",
  },
  {
    id: "quote",
    label: "Quote",
    description: "An emphasized quotation",
    aliases: ["blockquote", "citation"],
    icon: "quote",
    type: "quote",
  },
  {
    id: "divider",
    label: "Divider",
    description: "A quiet section break",
    aliases: ["line", "rule", "separator", "hr"],
    icon: "divider",
  },
  {
    id: "code",
    label: "Code",
    description: "A code block",
    aliases: ["pre", "snippet", "monospace"],
    icon: "code",
    type: "code",
  },
  {
    id: "page",
    label: "Page",
    description: "A nested note page",
    aliases: ["subpage", "nested page", "document"],
    icon: "page",
  },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return slashCommands;
  return slashCommands
    .map((command, index) => ({
      command,
      index,
      score: commandScore(command, normalized),
    }))
    .filter((candidate) => candidate.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ command }) => command);
}

export function matchSlashMenuQuery(
  text: string,
  caretOffset: number,
): string | null {
  if (caretOffset !== text.length) return null;
  const match = /^\/([^/\n]*)$/.exec(text);
  return match ? match[1] : null;
}

export type SlashMenuKeyAction =
  | { kind: "highlight"; index: number }
  | { kind: "select"; index: number }
  | { kind: "dismiss" };

export function slashMenuFocusTarget(
  mode: "slash" | "turn",
): "editor" | "trigger" {
  return mode === "slash" ? "editor" : "trigger";
}

export function resolveSlashMenuKey(
  key: string,
  selectedIndex: number,
  optionCount: number,
): SlashMenuKeyAction | null {
  if (key === "Escape") return { kind: "dismiss" };
  if (!optionCount) {
    if (key === "Enter") return { kind: "dismiss" };
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      return { kind: "highlight", index: 0 };
    }
    return null;
  }
  if (key === "ArrowDown") {
    return {
      kind: "highlight",
      index: (Math.max(0, selectedIndex) + 1) % optionCount,
    };
  }
  if (key === "ArrowUp") {
    return {
      kind: "highlight",
      index: (Math.max(0, selectedIndex) - 1 + optionCount) % optionCount,
    };
  }
  if (key === "Home") return { kind: "highlight", index: 0 };
  if (key === "End") return { kind: "highlight", index: optionCount - 1 };
  if (key === "Enter") {
    return {
      kind: "select",
      index: Math.min(Math.max(0, selectedIndex), optionCount - 1),
    };
  }
  return null;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function commandScore(command: SlashCommand, query: string): number {
  const label = normalizeSearch(command.label);
  const aliases = command.aliases.map(normalizeSearch);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (aliases.some((alias) => alias === query)) return 2;
  if (aliases.some((alias) => alias.startsWith(query))) return 3;
  if (label.includes(query)) return 4;
  if (aliases.some((alias) => alias.includes(query))) return 5;
  return Number.POSITIVE_INFINITY;
}
