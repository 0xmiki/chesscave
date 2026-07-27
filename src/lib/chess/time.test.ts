import { describe, expect, test } from "bun:test";
import {
  clockFromComment,
  formatClock,
  initialTimeControlSeconds,
  parseClockValue,
} from "./time";

describe("PGN clocks", () => {
  test("parses clock annotations with and without hours", () => {
    expect(parseClockValue("0:04:58")).toBe(298);
    expect(parseClockValue("3:39")).toBe(219);
    expect(clockFromComment("[%clk 0:04:57] developing move")).toBe(297);
    expect(clockFromComment("ordinary comment")).toBeNull();
  });

  test("reads common TimeControl headers", () => {
    expect(initialTimeControlSeconds("600+5")).toBe(600);
    expect(initialTimeControlSeconds("40/7200:3600")).toBe(7200);
    expect(initialTimeControlSeconds("*180")).toBe(180);
    expect(initialTimeControlSeconds("1 in 3 days")).toBe(259200);
    expect(initialTimeControlSeconds("?")).toBeNull();
  });

  test("formats live, classical, daily, and missing clocks", () => {
    expect(formatClock(219)).toBe("3:39");
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(259200)).toBe("3d");
    expect(formatClock(null)).toBe("--:--");
  });
});
