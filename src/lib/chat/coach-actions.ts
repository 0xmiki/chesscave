const DRILL_NOUN = /\b(?:drill|patch|flash\s*card|flashcard|exercise)\b/i;
const CREATE_VERB = /\b(?:create|make|build|add|save|turn|convert|generate)\b/i;

/**
 * Keep local app actions explicit. The coach remains read-only; ChessCave owns
 * creation and persistence when the student clearly asks for a drill.
 */
export function requestsDrillCreation(message: string): boolean {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text || !DRILL_NOUN.test(text) || !CREATE_VERB.test(text)) return false;

  return (
    /\b(?:create|make|build|add|save|generate)\b.{0,80}\b(?:drill|patch|flash\s*card|flashcard|exercise)\b/i.test(
      text,
    ) ||
    /\b(?:turn|convert)\b.{0,100}\b(?:this|that|it|move|idea|lesson|position|mistake|discussion)\b.{0,60}\b(?:into|to)\b.{0,30}\b(?:drill|patch|flash\s*card|flashcard|exercise)\b/i.test(
      text,
    )
  );
}

