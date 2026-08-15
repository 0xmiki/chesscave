import { describe, expect, test } from "bun:test";
import { requestsDrillCreation } from "./coach-actions";

describe("requestsDrillCreation", () => {
  test.each([
    "Create a drill for me on this move",
    "make this into a flashcard",
    "Turn that lesson into a drill so I remember it",
    "save this as a patch",
    "Can you generate an exercise from this position?",
  ])("recognizes an explicit drill request: %s", (message) => {
    expect(requestsDrillCreation(message)).toBe(true);
  });

  test.each([
    "How do drills work?",
    "What move should I make?",
    "This position needs more exercise",
    "Explain this mistake so I remember it",
  ])("does not turn normal coaching chat into an app action: %s", (message) => {
    expect(requestsDrillCreation(message)).toBe(false);
  });
});

