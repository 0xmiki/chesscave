function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(value: string): string {
  const code: string[] = [];
  let rendered = escapeHtml(value).replace(/`([^`\n]+)`/g, (_match, content: string) => {
    const index = code.push(`<code>${content}</code>`) - 1;
    return `\u0000${index}\u0000`;
  });

  rendered = rendered
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");

  return rendered.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => code[Number(index)] ?? "");
}

function isOrderedList(lines: string[], index: number): boolean {
  if (!/^\s*\d+[.)]\s+/.test(lines[index] ?? "")) return false;
  return /^\s*\d+[.)]\s+/.test(lines[index + 1] ?? "");
}

export function renderCoachMarkdown(value: string): string {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).replace(/[^a-z0-9_-]/gi, "");
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (isOrderedList(lines, index)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(renderInline(lines[index].replace(/^\s*>\s?/, "")));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.join("<br />")}</blockquote>`);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s*(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !isOrderedList(lines, index)
    ) {
      paragraph.push(renderInline(lines[index]));
      index += 1;
    }
    blocks.push(`<p>${paragraph.join("<br />")}</p>`);
  }

  return blocks.join("");
}
