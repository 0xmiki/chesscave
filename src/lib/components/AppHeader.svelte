<script lang="ts">
  import type { Snippet } from "svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  let {
    active,
    actions,
  }: {
    active: "home" | "play" | "study" | "drill" | "notes";
    actions?: Snippet;
  } = $props();
</script>

<header class="topbar">
  <a class="brand" href="/" aria-label="ChessCave home">
    <span class="brand-mark" aria-hidden="true">
      <img src="/chesscave-logo.svg" alt="" />
    </span>
  </a>

  <nav aria-label="Primary navigation">
    <a class:active={active === "home"} aria-current={active === "home" ? "page" : undefined} href="/">Home</a>
    <a class:active={active === "play"} aria-current={active === "play" ? "page" : undefined} href="/play/codex">Play</a>
    <a class:active={active === "study"} aria-current={active === "study" ? "page" : undefined} href="/study">Study</a>
    <a class:active={active === "drill"} aria-current={active === "drill" ? "page" : undefined} href="/drill">Drill</a>
    <a class:active={active === "notes"} aria-current={active === "notes" ? "page" : undefined} href="/notes">Notes</a>
  </nav>

  <div class="actions">
    {#if actions}{@render actions()}{/if}
    <ThemeToggle />
  </div>
</header>

<style>
  .topbar {
    position: relative;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 24px;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 58px;
    padding: 0 28px;
    border-bottom: 1px solid var(--line);
    background: var(--header-bg);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    text-decoration: none;
  }

  .brand-mark {
    display: block;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
  }

  .brand-mark img {
    display: block;
    width: 100%;
    height: 100%;
  }

  nav {
    display: flex;
    gap: 2px;
    align-items: center;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
    justify-self: center;
  }

  nav a {
    min-width: 54px;
    padding: 6px 11px;
    border-radius: 999px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 650;
    text-align: center;
    text-decoration: none;
  }

  nav a:hover {
    color: var(--ink);
  }

  nav a.active {
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    justify-self: end;
  }

  .actions :global(button),
  .actions :global(a) {
    min-height: 29px;
    max-height: 29px;
    border-radius: 999px;
    font-size: 11px;
  }

  @media (max-width: 1180px) {
    .topbar {
      gap: 16px;
      padding-inline: 20px;
    }

  }

  @media (max-width: 760px) {
    .topbar {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 10px;
      min-height: 54px;
      padding-inline: 12px;
    }

    .brand-mark {
      width: 26px;
      height: 26px;
    }

    nav a {
      min-width: 48px;
      padding-inline: 8px;
    }

  }

  @media (max-width: 520px) {
    .topbar {
      gap: 6px;
      padding-inline: 8px;
    }
  }
</style>
