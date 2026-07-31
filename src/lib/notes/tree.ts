import type { NoteBlockRecord } from "./types";

export interface VisiblePageNode {
  page: NoteBlockRecord;
  depth: number;
  parentId: string | null;
  childPageIds: string[];
}

export type PageTreeKeyAction =
  | { kind: "focus"; id: string }
  | { kind: "toggle"; id: string }
  | { kind: "rename"; id: string };

export function notePageTitle(page: NoteBlockRecord | null | undefined): string {
  if (!page) return "Untitled";
  const title = page.properties.title
    .map((run) => run.text)
    .join("")
    .trim();
  return title || "Untitled";
}

export function buildVisiblePageTree(
  rootPageIds: string[],
  pages: NoteBlockRecord[],
  expandedIds: Iterable<string>,
): VisiblePageNode[] {
  const pagesById = new Map(
    pages
      .filter((page) => page.type === "page")
      .map((page) => [page.id, page]),
  );
  const expanded = new Set(expandedIds);
  const visible: VisiblePageNode[] = [];
  const visited = new Set<string>();

  function visit(id: string, depth: number, parentId: string | null) {
    if (visited.has(id)) return;
    const page = pagesById.get(id);
    if (!page) return;
    visited.add(id);
    const childPageIds = page.content.filter((childId) =>
      pagesById.has(childId),
    );
    visible.push({ page, depth, parentId, childPageIds });
    if (!expanded.has(id)) return;
    for (const childId of childPageIds) visit(childId, depth + 1, id);
  }

  for (const rootId of rootPageIds) visit(rootId, 0, null);
  return visible;
}

export function resolvePageTreeKey(
  key: string,
  index: number,
  visible: VisiblePageNode[],
  expandedIds: Iterable<string>,
): PageTreeKeyAction | null {
  const node = visible[index];
  if (!node) return null;
  const expanded = new Set(expandedIds);

  if (key === "ArrowDown") {
    const next = visible[index + 1];
    return next ? { kind: "focus", id: next.page.id } : null;
  }
  if (key === "ArrowUp") {
    const previous = visible[index - 1];
    return previous ? { kind: "focus", id: previous.page.id } : null;
  }
  if (key === "Home") {
    const first = visible[0];
    return first ? { kind: "focus", id: first.page.id } : null;
  }
  if (key === "End") {
    const last = visible.at(-1);
    return last ? { kind: "focus", id: last.page.id } : null;
  }
  if (key === "ArrowRight" && node.childPageIds.length) {
    return expanded.has(node.page.id)
      ? { kind: "focus", id: node.childPageIds[0] }
      : { kind: "toggle", id: node.page.id };
  }
  if (key === "ArrowLeft") {
    if (expanded.has(node.page.id) && node.childPageIds.length) {
      return { kind: "toggle", id: node.page.id };
    }
    return node.parentId ? { kind: "focus", id: node.parentId } : null;
  }
  if (key === "F2") return { kind: "rename", id: node.page.id };
  return null;
}
