import { describe, expect, test } from "bun:test";
import { renderCoachMarkdown } from "./markdown";

describe("Coach response rendering", () => {
  test("renders useful response structure", () => {
    const rendered = renderCoachMarkdown(
      "### The idea\n\n- Stop the threat\n- Improve the knight\n\n**Best move:** `Nf3`",
    );

    expect(rendered).toContain("<h5>The idea</h5>");
    expect(rendered).toContain("<ul><li>Stop the threat</li><li>Improve the knight</li></ul>");
    expect(rendered).toContain("<strong>Best move:</strong> <code>Nf3</code>");
  });

  test("escapes untrusted HTML before applying formatting", () => {
    const rendered = renderCoachMarkdown('<img src=x onerror="alert(1)"> **safe**');
    expect(rendered).not.toContain("<img");
    expect(rendered).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered).toContain("<strong>safe</strong>");
  });

  test("keeps a chess variation as prose rather than a one-item list", () => {
    expect(renderCoachMarkdown("1. e4 e5 2. Nf3 Nc6")).toBe(
      "<p>1. e4 e5 2. Nf3 Nc6</p>",
    );
  });
});
