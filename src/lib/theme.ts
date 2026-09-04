export type ColorTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "chesscave.theme.v1";

export function resolveTheme(saved: string | null): ColorTheme {
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}
