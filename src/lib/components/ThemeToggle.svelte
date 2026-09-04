<script lang="ts">
  import { onMount } from "svelte";
  import { resolveTheme, THEME_STORAGE_KEY, type ColorTheme } from "$lib/theme";

  let theme = $state<ColorTheme>("dark");

  function applyTheme(next: ColorTheme) {
    theme = next;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", next === "dark" ? "#111210" : "#f1ede5");
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  onMount(() => {
    applyTheme(resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)));
  });
</script>

<button
  class="theme-toggle"
  type="button"
  onclick={toggleTheme}
  aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
  title={theme === "dark" ? "Use light theme" : "Use dark theme"}
>
  {#if theme === "dark"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5"></circle>
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"></path>
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.5 15.2A8 8 0 0 1 8.8 4.5 8 8 0 1 0 19.5 15.2Z"></path>
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    display: grid;
    width: 29px;
    height: 29px;
    place-items: center;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    cursor: pointer;
  }

  .theme-toggle:hover {
    border-color: var(--coral);
    color: var(--coral-dark);
    background: var(--coral-soft);
  }

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }
</style>
