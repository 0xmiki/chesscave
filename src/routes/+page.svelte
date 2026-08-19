<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import RatingSparkline from "$lib/components/RatingSparkline.svelte";
  import { parsePgn } from "$lib/chess/game";
  import {
    CHESSCOM_DASHBOARD_STORAGE_KEY,
    CHESSCOM_USERNAME_STORAGE_KEY,
    STUDY_STORAGE_KEY,
    formatChessComTimeControl,
    gamesForTimeClass,
    normalizeChessComUsername,
    ratingHistory,
    ratingStatsFor,
    recentRatingChange,
    reviewedGameUrls,
    summarizeChessComGame,
    type ChessComDashboard,
    type ChessComGame,
    type ChessComTimeClass,
  } from "$lib/chess/chesscom";
  import {
    getChessComDashboard,
    hasNativeHost,
  } from "$lib/services/native";

  const timeClasses: { id: ChessComTimeClass; label: string }[] = [
    { id: "rapid", label: "Rapid" },
    { id: "blitz", label: "Blitz" },
  ];
  const dayDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const gameTimeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const syncDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  let hydrated = $state(false);
  let username = $state("");
  let usernameInput = $state("");
  let dashboard = $state<ChessComDashboard | null>(null);
  let syncing = $state(false);
  let syncError = $state("");
  let editingProfile = $state(false);
  let activeTimeClass = $state<ChessComTimeClass>("rapid");
  let openingGameUrl = $state("");
  let reviewedUrls = $state<Set<string>>(new Set());
  let activeDayKey = $state("");
  let dayScroller = $state<HTMLElement | null>(null);

  const profileTitle = $derived(
    dashboard?.profile.name || dashboard?.profile.username || "Your Chess.com games",
  );
  const rapidGames = $derived(gamesForTimeClass(dashboard, "rapid"));
  const blitzGames = $derived(gamesForTimeClass(dashboard, "blitz"));
  const activeGames = $derived(
    activeTimeClass === "rapid" ? rapidGames : blitzGames,
  );
  const activeGameDays = $derived(groupGamesByDay(activeGames));
  const activeGameDay = $derived(
    activeGameDays.find((day) => day.key === activeDayKey) ??
      activeGameDays[0] ??
      null,
  );

  $effect(() => {
    const firstDayKey = activeGameDays[0]?.key ?? "";
    if (!activeGameDays.some((day) => day.key === activeDayKey)) {
      activeDayKey = firstDayKey;
    }
  });

  onMount(() => {
    hydrated = true;
    reviewedUrls = reviewedGameUrls();
    const savedUsername = localStorage.getItem(CHESSCOM_USERNAME_STORAGE_KEY) ?? "";
    username = savedUsername;
    usernameInput = savedUsername;

    try {
      const cached = JSON.parse(
        localStorage.getItem(CHESSCOM_DASHBOARD_STORAGE_KEY) ?? "null",
      ) as { username?: string; dashboard?: ChessComDashboard } | null;
      if (cached?.username === savedUsername && cached.dashboard) {
        dashboard = cached.dashboard;
      }
    } catch {
      localStorage.removeItem(CHESSCOM_DASHBOARD_STORAGE_KEY);
    }

    if (savedUsername && hasNativeHost()) void syncProfile(savedUsername);
  });

  async function syncProfile(value: string) {
    let normalized: string;
    try {
      normalized = normalizeChessComUsername(value);
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
      return;
    }

    syncing = true;
    syncError = "";
    try {
      const next = await getChessComDashboard(normalized);
      username = next.profile.username || normalized;
      usernameInput = username;
      dashboard = next;
      editingProfile = false;
      reviewedUrls = reviewedGameUrls();
      localStorage.setItem(CHESSCOM_USERNAME_STORAGE_KEY, username);
      localStorage.setItem(
        CHESSCOM_DASHBOARD_STORAGE_KEY,
        JSON.stringify({ username, dashboard: next }),
      );
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
    } finally {
      syncing = false;
    }
  }

  function submitUsername(event: SubmitEvent) {
    event.preventDefault();
    void syncProfile(usernameInput);
  }

  async function openGame(game: ChessComGame) {
    try {
      const parsed = parsePgn(game.pgn);
      if (!parsed.moves.length) throw new Error("This game has no playable moves.");
      openingGameUrl = game.url;
      localStorage.setItem(
        STUDY_STORAGE_KEY,
        JSON.stringify({
          pgn: game.pgn,
          currentPly: parsed.moves.length,
          sourceUrl: game.url,
        }),
      );
      await goto("/study");
    } catch (error) {
      openingGameUrl = "";
      syncError = `Could not open this game: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function gamesFor(timeClass: ChessComTimeClass) {
    return timeClass === "rapid" ? rapidGames : blitzGames;
  }

  async function selectTimeClass(timeClass: ChessComTimeClass) {
    if (activeTimeClass === timeClass) return;
    activeTimeClass = timeClass;
    activeDayKey = "";
    await tick();
    if (dayScroller) dayScroller.scrollTop = 0;
  }

  function updateVisibleDay(event: Event) {
    const scroller = event.currentTarget as HTMLElement;
    const marker = scroller.getBoundingClientRect().top + 36;
    const groups = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-day-key]"),
    );
    let nextKey = groups[0]?.dataset.dayKey ?? "";
    for (const group of groups) {
      if (group.getBoundingClientRect().top > marker) break;
      nextKey = group.dataset.dayKey ?? nextKey;
    }
    if (nextKey && nextKey !== activeDayKey) activeDayKey = nextKey;
  }

  function localDayKey(timestamp: number) {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dayLabel(timestamp: number) {
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const key = localDayKey(timestamp);
    const todayKey = localDayKey(today.getTime() / 1000);
    const yesterdayKey = localDayKey(yesterday.getTime() / 1000);
    if (key === todayKey) return "Today";
    if (key === yesterdayKey) return "Yesterday";
    return dayDateFormatter.format(date);
  }

  function groupGamesByDay(games: ChessComGame[]) {
    const groups = new Map<string, ChessComGame[]>();
    for (const game of games) {
      const key = localDayKey(game.endTime);
      const existing = groups.get(key);
      if (existing) existing.push(game);
      else groups.set(key, [game]);
    }
    return [...groups].map(([key, dayGames]) => ({
      key,
      label: dayLabel(dayGames[0].endTime),
      games: dayGames,
    }));
  }

  function formatGameTime(timestamp: number) {
    return gameTimeFormatter.format(new Date(timestamp * 1000));
  }

  function formatHistoryTimeControl(value: string) {
    const formatted = formatChessComTimeControl(value);
    return formatted.endsWith("s") ? formatted : `${formatted} min`;
  }

  function isCurrentPlayer(playerUsername: string) {
    return playerUsername.toLowerCase() === username.toLowerCase();
  }

  function scoreFor(game: ChessComGame, side: "white" | "black") {
    const player = game[side];
    const opponent = side === "white" ? game.black : game.white;
    if (player.result === "win") return "1";
    if (opponent.result === "win") return "0";
    return "½";
  }

  function formatAccuracy(value: number | null | undefined) {
    return value == null ? "—" : `${value.toFixed(1)}%`;
  }

  function fullMoveCount(game: ChessComGame) {
    try {
      return Math.ceil(parsePgn(game.pgn).moves.length / 2);
    } catch {
      return "—";
    }
  }

  function formatSyncDate(timestamp: number) {
    return syncDateFormatter.format(new Date(timestamp));
  }

  function formatJoined(timestamp: number | null) {
    if (!timestamp) return null;
    return new Date(timestamp * 1000).getFullYear();
  }

  function trendLabel(change: number | null) {
    if (change === null) return "Recent form";
    return `${change > 0 ? "+" : ""}${change} recently`;
  }
</script>

<svelte:head>
  <title>Home — ChessCave</title>
  <meta
    name="description"
    content="Your recent Chess.com games, rating progress, and saved ChessCave reviews."
  />
</svelte:head>

<div class="app-shell">
  {#snippet headerActions()}
    {#if dashboard}
      <div class="top-actions">
        <button
          class="quiet-action"
          type="button"
          onclick={() => {
            usernameInput = username;
            editingProfile = !editingProfile;
          }}
        >Change player</button>
        <button
          class:working={syncing}
          class="refresh-action"
          type="button"
          disabled={syncing}
          onclick={() => void syncProfile(username)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 7v5h-5M5 17v-5h5"></path>
            <path d="M17.5 9A6.5 6.5 0 0 0 6 7.5L5 12m14 0-1 4.5A6.5 6.5 0 0 1 6.5 15"></path>
          </svg>
          {syncing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    {/if}
  {/snippet}

  <AppHeader
    active="home"
    title={dashboard ? profileTitle : "Your chess, ready to study"}
    subtitle={dashboard
      ? `Chess.com · Updated ${formatSyncDate(dashboard.fetchedAtMs)}`
      : "Connect a public Chess.com profile"}
    actions={headerActions}
  />

  <main>
    {#if hydrated && !dashboard}
      <section class="onboarding" aria-labelledby="onboarding-title">
        <div class="onboarding-copy">
          <span class="eyebrow">CHESS.COM LIBRARY</span>
          <h2 id="onboarding-title">Bring your games into the cave.</h2>
          <p>
            Connect a public username once. ChessCave will keep your recent Rapid
            and Blitz games close, then open any of them directly in the study board.
          </p>
        </div>

        <form class="username-form" onsubmit={submitUsername}>
          <label for="chesscom-username">What is your username on Chess.com?</label>
          <div class="username-field">
            <span aria-hidden="true">@</span>
            <input
              id="chesscom-username"
              bind:value={usernameInput}
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="your_username"
              disabled={syncing}
            />
            <button type="submit" disabled={syncing || !usernameInput.trim()}>
              {syncing ? "Connecting…" : "Connect profile"}
            </button>
          </div>
          {#if syncError}<p class="form-error" role="alert">{syncError}</p>{/if}
          <small>Only public profile, rating, and game data is requested.</small>
        </form>
      </section>
    {:else if dashboard}
      <div class="dashboard">
        {#if editingProfile}
          <form class="profile-editor" onsubmit={submitUsername}>
            <label for="change-username">Chess.com username</label>
            <div>
              <input
                id="change-username"
                bind:value={usernameInput}
                autocapitalize="none"
                spellcheck="false"
                disabled={syncing}
              />
              <button type="submit" disabled={syncing || !usernameInput.trim()}>
                {syncing ? "Loading…" : "Use this profile"}
              </button>
              <button class="cancel" type="button" onclick={() => (editingProfile = false)}>Cancel</button>
            </div>
          </form>
        {/if}

        {#if syncError}
          <div class="sync-error" role="status">
            <span>{syncError}</span>
            <button type="button" onclick={() => (syncError = "")}>Dismiss</button>
          </div>
        {/if}

        <section class="profile" aria-label="Chess.com profile">
          <div class="avatar">
            {#if dashboard.profile.avatar}
              <img src={dashboard.profile.avatar} alt="" />
            {:else}
              <span>{dashboard.profile.username.slice(0, 1).toUpperCase()}</span>
            {/if}
          </div>
          <div class="identity">
            <span class="eyebrow">CHESS.COM PROFILE</span>
            <div class="profile-name">
              <h2>{dashboard.profile.name || dashboard.profile.username}</h2>
              {#if dashboard.profile.title}<span>{dashboard.profile.title}</span>{/if}
            </div>
            <p>
              @{dashboard.profile.username}
              {#if dashboard.profile.location} · {dashboard.profile.location}{/if}
              {#if formatJoined(dashboard.profile.joined)} · Member since {formatJoined(dashboard.profile.joined)}{/if}
            </p>
          </div>
          <a
            href={dashboard.profile.url || `https://www.chess.com/member/${dashboard.profile.username}`}
            target="_blank"
            rel="noreferrer"
          >View public profile <span aria-hidden="true">↗</span></a>
        </section>

        <section class="ratings" aria-label="Rating progress">
          {#each timeClasses as timeClass}
            {@const stats = ratingStatsFor(dashboard, timeClass.id)}
            {@const history = ratingHistory(dashboard, username, timeClass.id)}
            {@const change = recentRatingChange(stats, history)}
            <article class="rating-card">
              <header>
                <div>
                  <span>{timeClass.label}</span>
                  <strong>{stats?.last?.rating ?? "—"}</strong>
                </div>
                <div class:positive={change !== null && change > 0} class:negative={change !== null && change < 0} class="trend">
                  {trendLabel(change)}
                </div>
              </header>
              <RatingSparkline
                points={history}
                label={`${timeClass.label} rating history across ${history.length} recent games`}
              />
              <footer>
                <span><strong>{stats?.record.win ?? 0}</strong> wins</span>
                <span><strong>{stats?.record.draw ?? 0}</strong> draws</span>
                <span><strong>{stats?.record.loss ?? 0}</strong> losses</span>
                <span class="best">Best {stats?.best?.rating ?? "—"}</span>
              </footer>
            </article>
          {/each}
        </section>

        <section
          class="history"
          class:blitz-history={activeTimeClass === "blitz"}
          aria-labelledby="game-history-title"
        >
          <div class="history-toolbar">
            <div class="history-position" aria-live="polite">
              <span>GAME HISTORY</span>
              <div>
                <h3 id="game-history-title">{activeGameDay?.label ?? "Game history"}</h3>
                <span>
                  {activeGameDay
                    ? `${activeGameDay.games.length} ${activeGameDay.games.length === 1 ? "game" : "games"}`
                    : "No games"}
                </span>
              </div>
            </div>
            <div class="history-tabs" role="tablist" aria-label="Game type">
              {#each timeClasses as timeClass}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTimeClass === timeClass.id}
                  class:active={activeTimeClass === timeClass.id}
                  onclick={() => void selectTimeClass(timeClass.id)}
                >
                  {timeClass.label}
                  <span>{gamesFor(timeClass.id).length}</span>
                </button>
              {/each}
            </div>
          </div>

          {#if activeGames.length}
            <div
              class="history-table"
              role="tabpanel"
              aria-label={`${activeTimeClass} game history`}
              bind:this={dayScroller}
              onscroll={updateVisibleDay}
            >
              <div class="history-header">
                <span>Time control</span>
                <span>Players</span>
                <span>Result</span>
                <span>Accuracy</span>
                <span>Moves</span>
                <span>Played</span>
                <span>Study</span>
              </div>
              <div class="day-groups">
                {#each activeGameDays as day (day.key)}
                  <section
                    class="day-group"
                    aria-label={day.label}
                    data-day-key={day.key}
                  >
                  <div class="history-list">
                    {#each day.games as game (game.uuid || game.url)}
                      {@const summary = summarizeChessComGame(game, username)}
                      <button
                        class="history-row"
                        type="button"
                        disabled={Boolean(openingGameUrl)}
                        aria-label={`${summary.outcome === "win" ? "Won" : summary.outcome === "draw" ? "Drew" : "Lost"} against ${summary.opponent.username}, ${formatHistoryTimeControl(game.timeControl)}, played ${formatGameTime(game.endTime)}. ${reviewedUrls.has(game.url) ? "Reviewed" : "Not reviewed"}. Open game in Study.`}
                        onclick={() => void openGame(game)}
                      >
                        <span class="history-time">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="13" r="7"></circle>
                            <path d="M12 6V3m-3 0h6m-3 10 3-2"></path>
                          </svg>
                          <span>
                            <strong>{formatHistoryTimeControl(game.timeControl)}</strong>
                            <small>{formatGameTime(game.endTime)}</small>
                          </span>
                        </span>

                        <span class="history-players">
                          <span class:current-player={isCurrentPlayer(game.white.username)}>
                            <i class="player-avatar white-avatar">
                              {#if isCurrentPlayer(game.white.username) && dashboard.profile.avatar}
                                <img src={dashboard.profile.avatar} alt="" />
                              {:else}
                                {game.white.username.slice(0, 1).toUpperCase()}
                              {/if}
                            </i>
                            <i class="piece-color white"></i>
                            <strong>{game.white.username}</strong>
                            <em>({game.white.rating})</em>
                            {#if isCurrentPlayer(game.white.username)}<small>You</small>{/if}
                          </span>
                          <span class:current-player={isCurrentPlayer(game.black.username)}>
                            <i class="player-avatar black-avatar">
                              {#if isCurrentPlayer(game.black.username) && dashboard.profile.avatar}
                                <img src={dashboard.profile.avatar} alt="" />
                              {:else}
                                {game.black.username.slice(0, 1).toUpperCase()}
                              {/if}
                            </i>
                            <i class="piece-color black"></i>
                            <strong>{game.black.username}</strong>
                            <em>({game.black.rating})</em>
                            {#if isCurrentPlayer(game.black.username)}<small>You</small>{/if}
                          </span>
                        </span>

                        <span class="history-result">
                          <span
                            class={`result-icon ${summary.outcome}`}
                            role="img"
                            aria-label={summary.outcome === "win" ? "Won" : summary.outcome === "draw" ? "Draw" : "Lost"}
                            title={summary.outcome === "win" ? "Won" : summary.outcome === "draw" ? "Draw" : "Lost"}
                          >
                            {#if summary.outcome === "win"}
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.3 4.3L19 7.2"></path></svg>
                            {:else if summary.outcome === "loss"}
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>
                            {:else}
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9h12M6 15h12"></path></svg>
                            {/if}
                          </span>
                          <small>{scoreFor(game, "white")}–{scoreFor(game, "black")}</small>
                        </span>

                        <span class="history-accuracy">
                          <span>{formatAccuracy(game.accuracies?.white)}</span>
                          <span>{formatAccuracy(game.accuracies?.black)}</span>
                        </span>

                        <span class="history-moves">{fullMoveCount(game)}</span>
                        <span class="history-date">{formatGameTime(game.endTime)}</span>
                        <span class="review-status" class:reviewed={reviewedUrls.has(game.url)}>
                          <strong>
                            {openingGameUrl === game.url
                              ? "Opening…"
                              : reviewedUrls.has(game.url)
                                ? "Reopen"
                                : "Study"}
                          </strong>
                          <small>{reviewedUrls.has(game.url) ? "Reviewed" : "Not reviewed"}</small>
                        </span>
                      </button>
                    {/each}
                  </div>
                  </section>
                {/each}
              </div>
            </div>
          {:else}
            <div class="empty-games">No recent {activeTimeClass} games found.</div>
          {/if}
        </section>
      </div>
    {/if}
  </main>
</div>

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: 68px minmax(0, 1fr);
    color: var(--ink);
    background: var(--paper);
  }

  main {
    grid-row: 2;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .top-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .top-actions button {
    min-height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .quiet-action {
    border: 1px solid var(--line-strong);
    color: var(--ink-soft);
    background: transparent;
  }

  .refresh-action {
    display: inline-flex;
    gap: 7px;
    align-items: center;
    border: 1px solid var(--ink);
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .refresh-action:disabled {
    opacity: 0.62;
    cursor: wait;
  }

  .refresh-action svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .refresh-action.working svg {
    animation: spin 900ms linear infinite;
  }

  .onboarding {
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
    gap: clamp(56px, 9vw, 130px);
    align-items: center;
    width: min(1080px, calc(100% - 64px));
    min-height: 100%;
    margin: 0 auto;
    padding: 72px 0 96px;
  }

  .eyebrow {
    color: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.13em;
  }

  .onboarding-copy h2,
  .identity h2 {
    margin: 0;
    font-family: var(--display);
    font-variation-settings: "opsz" 48, "wght" 570;
  }

  .onboarding-copy h2 {
    max-width: 12ch;
    margin-top: 12px;
    font-size: clamp(43px, 5vw, 68px);
    line-height: 0.99;
  }

  .onboarding-copy p {
    max-width: 48ch;
    margin: 23px 0 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.65;
  }

  .username-form {
    padding: 30px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--pearl);
    box-shadow: 0 20px 60px rgba(74, 58, 43, 0.08);
  }

  .username-form label,
  .profile-editor label {
    display: block;
    margin-bottom: 11px;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 650;
  }

  .username-field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    min-height: 48px;
    padding-left: 14px;
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    background: var(--pearl-raised);
  }

  .username-field > span {
    color: var(--faint);
    font-size: 14px;
  }

  .username-field input,
  .profile-editor input {
    min-width: 0;
    border: 0;
    color: var(--ink);
    background: transparent;
    outline: 0;
  }

  .username-field input {
    height: 46px;
    padding: 0 8px;
  }

  .username-field button,
  .profile-editor button {
    min-height: 38px;
    margin-right: 5px;
    padding: 0 14px;
    border: 0;
    border-radius: 7px;
    color: var(--pearl-raised);
    background: var(--ink);
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .username-field button:disabled,
  .profile-editor button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .username-form small {
    display: block;
    margin-top: 12px;
    color: var(--faint);
    font-size: 10px;
  }

  .form-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 11px;
  }

  .dashboard {
    display: flex;
    flex-direction: column;
    width: min(1180px, calc(100% - 56px));
    height: 100%;
    min-height: 0;
    margin: 0 auto;
    padding: 30px 0 24px;
  }

  .profile-editor {
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    align-items: center;
    margin-bottom: 22px;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--pearl);
  }

  .profile-editor label {
    margin: 0;
  }

  .profile-editor > div {
    display: flex;
    gap: 8px;
  }

  .profile-editor input {
    flex: 1;
    min-height: 38px;
    padding: 0 11px;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    background: var(--pearl-raised);
  }

  .profile-editor .cancel {
    color: var(--ink-soft);
    border: 1px solid var(--line);
    background: transparent;
  }

  .sync-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 22px;
    padding: 11px 14px;
    border: 1px solid rgba(169, 79, 66, 0.28);
    border-radius: 8px;
    color: var(--danger);
    background: var(--coral-soft);
    font-size: 11px;
  }

  .sync-error button {
    border: 0;
    color: inherit;
    background: transparent;
    font-size: 10px;
    cursor: pointer;
  }

  .profile {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 20px;
    align-items: center;
    padding: 0 0 34px;
    border-bottom: 1px solid var(--line);
  }

  .avatar {
    display: grid;
    width: 72px;
    height: 72px;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    color: var(--coral-dark);
    background: var(--pearl-raised);
    font-family: var(--display);
    font-size: 28px;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .identity {
    min-width: 0;
  }

  .profile-name {
    display: flex;
    gap: 9px;
    align-items: center;
    margin-top: 5px;
  }

  .identity h2 {
    overflow: hidden;
    font-size: 31px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-name > span {
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--pearl-raised);
    background: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
  }

  .identity p {
    margin: 5px 0 0;
    color: var(--muted);
    font-size: 11px;
  }

  .profile > a {
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 650;
    text-decoration: none;
  }

  .profile > a:hover {
    color: var(--coral-dark);
  }

  .ratings {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 30px;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--pearl);
  }

  .rating-card {
    min-width: 0;
    padding: 22px 24px 17px;
  }

  .rating-card + .rating-card {
    border-left: 1px solid var(--line);
  }

  .rating-card > header {
    display: flex;
    align-items: start;
    justify-content: space-between;
  }

  .rating-card header > div:first-child {
    display: grid;
    gap: 1px;
  }

  .rating-card header span {
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .rating-card header strong {
    font-family: var(--display);
    font-size: 37px;
    font-variation-settings: "opsz" 42, "wght" 570;
    line-height: 1.05;
  }

  .trend {
    margin-top: 3px;
    color: var(--faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .trend.positive { color: var(--sage); }
  .trend.negative { color: var(--danger); }

  .rating-card footer {
    display: flex;
    gap: 15px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 9px;
  }

  .rating-card footer strong {
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .rating-card footer .best {
    margin-left: auto;
    color: var(--faint);
  }

  .history {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    /* Use the remaining dashboard height. An auto flex basis measures every
       game row first, making the card extend behind main's clipped viewport
       instead of giving .history-table a real overflow boundary. */
    flex: 1 1 0;
    min-height: 140px;
    margin-top: 30px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--pearl);
    font-family: var(--interface);
  }

  .history-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 72px;
    padding: 12px 16px 12px 20px;
    border-bottom: 1px solid var(--line);
  }

  .history-position {
    display: grid;
    gap: 4px;
  }

  .history-position > span {
    color: var(--coral-dark);
    font-size: 8px;
    font-weight: 750;
    letter-spacing: 0.12em;
  }

  .history-position > div {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }

  .history-toolbar h3 {
    margin: 0;
    font-family: var(--display);
    font-size: 21px;
    font-variation-settings: "opsz" 24, "wght" 590;
  }

  .history-position > div > span {
    color: var(--faint);
    font-size: 10px;
  }

  .history-tabs {
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--paper);
  }

  .history-tabs button {
    display: flex;
    gap: 7px;
    align-items: center;
    min-height: 31px;
    padding: 0 11px;
    border: 0;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .history-tabs button span {
    color: var(--faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .history-tabs button.active {
    color: var(--pearl-raised);
    background: var(--sage);
  }

  .history-tabs button.active span {
    color: rgba(255, 255, 255, 0.72);
  }

  .blitz-history .history-tabs button.active {
    background: var(--ochre);
  }

  .history-header,
  .history-row {
    display: grid;
    grid-template-columns: 86px minmax(220px, 1fr) 82px 92px 58px 106px 86px;
    gap: 12px;
    align-items: center;
  }

  .history-header {
    position: sticky;
    top: 0;
    z-index: 3;
    min-height: 34px;
    padding: 0 18px;
    border-bottom: 1px solid var(--line);
    color: var(--faint);
    background: var(--paper);
    box-shadow: 0 1px 0 rgba(68, 53, 42, 0.04);
    font-size: 10px;
    font-weight: 650;
  }

  .history-list {
    display: grid;
  }

  .history-table {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-color: var(--line-strong) transparent;
    scrollbar-gutter: stable;
  }

  .day-groups {
    display: grid;
  }

  .day-group + .day-group {
    border-top: 1px solid var(--line-strong);
  }

  .history-row {
    width: 100%;
    min-height: 82px;
    padding: 8px 18px;
    border: 0;
    border-top: 1px solid var(--line);
    color: var(--ink);
    background: transparent;
    text-align: left;
    line-height: 1.25;
    cursor: pointer;
    transition: background var(--motion-fast) ease-out;
  }

  .history-row:first-child {
    border-top: 0;
  }

  .history-row:hover:not(:disabled) {
    background: rgba(255, 253, 248, 0.82);
  }

  .history-row:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--coral);
    outline-offset: -2px;
  }

  .history-row:disabled {
    cursor: wait;
  }

  .history-time {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--sage);
  }

  .blitz-history .history-time {
    color: var(--ochre);
  }

  .history-time > svg {
    width: 21px;
    height: 21px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .history-time > span {
    display: grid;
    gap: 2px;
  }

  .history-time strong {
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .history-time small {
    display: none;
    color: var(--faint);
    font-size: 9px;
    white-space: nowrap;
  }

  .history-players {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .history-players > span {
    display: flex;
    gap: 7px;
    align-items: center;
    min-width: 0;
    color: var(--muted);
  }

  .history-players strong {
    min-width: 0;
    max-width: 30ch;
    overflow: hidden;
    font-size: 12px;
    font-weight: 580;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-players em {
    color: var(--faint);
    font-size: 11px;
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }

  .history-players > span.current-player strong {
    color: var(--ink);
    font-weight: 700;
  }

  .history-players > span > small {
    color: var(--sage);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0;
  }

  .player-avatar {
    display: grid;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    overflow: hidden;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 5px;
    color: var(--muted);
    background: var(--pearl-raised);
    font-family: var(--display);
    font-size: 11px;
    font-style: normal;
  }

  .player-avatar.black-avatar {
    color: var(--paper);
    border-color: var(--ink-soft);
    background: var(--ink-soft);
  }

  .player-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .piece-color {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border: 1px solid var(--line-strong);
    border-radius: 1px;
    background: var(--pearl-raised);
  }

  .piece-color.black {
    border-color: var(--ink-soft);
    background: var(--ink-soft);
  }

  .history-result {
    display: grid;
    justify-items: center;
    gap: 4px;
    font-variant-numeric: tabular-nums;
  }

  .result-icon {
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
    color: var(--ink-soft);
  }

  .result-icon.win {
    color: var(--sage);
  }

  .result-icon.loss {
    color: var(--coral-dark);
  }

  .result-icon svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.2;
  }

  .history-result > small {
    color: var(--faint);
    font-size: 10px;
    font-weight: 550;
  }

  .history-accuracy {
    display: grid;
    grid-template-rows: repeat(2, 26px);
    gap: 4px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .history-moves,
  .history-date {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .review-status {
    display: grid;
    justify-items: start;
    gap: 2px;
    color: var(--coral-dark);
  }

  .review-status strong {
    font-size: 11px;
    font-weight: 680;
  }

  .review-status strong::after {
    content: " →";
  }

  .review-status small {
    color: var(--faint);
    font-size: 8px;
    font-weight: 550;
  }

  .review-status.reviewed strong {
    color: var(--sage);
  }

  .empty-games {
    display: grid;
    min-height: 180px;
    place-items: center;
    color: var(--faint);
    font-size: 11px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 940px) {
    .onboarding {
      grid-template-columns: 1fr;
      gap: 42px;
      align-content: center;
      width: min(640px, calc(100% - 40px));
    }

    .onboarding-copy h2 {
      max-width: 14ch;
    }

    .dashboard {
      width: min(760px, calc(100% - 40px));
    }

    .history-header,
    .history-row {
      min-width: 850px;
    }
  }

  @media (max-width: 680px) {
    .app-shell {
      grid-template-rows: 62px minmax(0, 1fr);
    }

    main {
      overflow: auto;
      scrollbar-color: var(--line-strong) transparent;
    }

    .dashboard {
      display: block;
      height: auto;
      padding-bottom: 36px;
    }

    .ratings {
      grid-template-columns: 1fr;
    }

    .rating-card + .rating-card {
      border-top: 1px solid var(--line);
      border-left: 0;
    }

    .history {
      height: min(560px, 68vh);
    }

    .top-actions .quiet-action {
      display: none;
    }

    .refresh-action {
      width: 36px;
      justify-content: center;
      padding: 0;
      font-size: 0;
    }

    .profile {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .profile > a {
      grid-column: 2;
    }

    .profile-editor {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .history-toolbar {
      align-items: flex-start;
      gap: 12px;
    }

    .history-position > div {
      display: grid;
      gap: 2px;
    }

    .username-field {
      grid-template-columns: auto minmax(0, 1fr);
      padding-right: 5px;
    }

    .username-field button {
      grid-column: 1 / -1;
      width: calc(100% - 5px);
      margin-bottom: 5px;
    }
  }
</style>
