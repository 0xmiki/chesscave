import { describe, expect, test } from "bun:test";
import { resolveTheme } from "./theme";

describe("color theme", () => {
  test("uses a saved choice", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  test("defaults to dark when no valid choice is saved", () => {
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme("invalid")).toBe("dark");
  });
});
