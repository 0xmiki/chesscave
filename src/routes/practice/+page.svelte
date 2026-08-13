<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import {
    CHESSCOM_DASHBOARD_STORAGE_KEY,
    CHESSCOM_USERNAME_STORAGE_KEY,
    STUDY_STORAGE_KEY,
    summarizeChessComGame,
    type ChessComDashboard,
    type ChessComGame,
  } from "$lib/chess/chesscom";
  import {
    PRACTICE_LAUNCH_STORAGE_KEY,
    type PracticeLaunch,
  } from "$lib/chess/conversion";
  import { parsePgn } from "$lib/chess/game";
  import {
    buildWeeklyGameInsight,
    buildWeeklyReport,
    rapidGamesLastSevenDays,
    reconcileWeeklyInsights,
    WEEKLY_REPORT_STORAGE_KEY,
    type WeeklyGameInsight,
    type WeeklyMoment,
  } from "$lib/chess/weekly";
  import type { ReviewProgress, Side } from "$lib/chess/types";
  import {
    getEngineStatus,
    getChessComRapidSince,
    hasNativeHost,
    onReviewProgress,
    reviewGame,
  } from "$lib/services/native";

  interface CachedWeeklyReport {
    username: string;
    gameIds: string[];
    generatedAtMs: number;
    insights: WeeklyGameInsight[];
  }

  let hydrated = $state(false);
  let username = $state("");
  let weeklyGames = $state<ChessComGame[]>([]);
  let insights = $state<WeeklyGameInsight[]>([]);
  let analyzing = $state(false);
  let cancelRequested = false;
  let completed = $state(0);
  let analysisTotal = $state(0);
  let analysisError = $state("");
  let skippedGames = $state(0);
  let currentOpponent = $state("");
  let positionProgress = $state<ReviewProgress | null>(null);
  let syncingGames = $state(false);
  let syncError = $state("");

  const report = $derived(buildWeeklyReport(insights));
  const gameById = $derived(
    new Map(weeklyGames.map((game) => [gameId(game), game])),
  );
  const weekAccuracy = $derived.by(() => {
    if (!insights.length) return null;
    return (
      insights.reduce((sum, insight) => sum + insight.accuracy, 0) /
      insights.length
    );
  });
  const seriousErrors = $derived(
    insights.reduce((sum, insight) => sum + insight.seriousErrors, 0),
  );

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    hydrated = true;
    username = localStorage.getItem(CHESSCOM_USERNAME_STORAGE_KEY) ?? "";
    try {
      const cachedDashboard = JSON.parse(
        localStorage.getItem(CHESSCOM_DASHBOARD_STORAGE_KEY) ?? "null",
      ) as { username?: string; dashboard?: ChessComDashboard } | null;
      if (cachedDashboard?.username === username && cachedDashboard.dashboard) {
        weeklyGames = rapidGamesLastSevenDays(cachedDashboard.dashboard.games);
        restoreWeeklyReport();
      }
    } catch {
      localStorage.removeItem(WEEKLY_REPORT_STORAGE_KEY);
    }

    if (hasNativeHost()) {
      void onReviewProgress((progress) => {
        if (!disposed) positionProgress = progress;
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
      if (username) void refreshRecentGames();
    }
    return () => {
      disposed = true;
      cancelRequested = true;
      unlisten?.();
    };
  });

  function gameId(game: ChessComGame): string {
    return game.uuid || game.url;
  }

  async function refreshRecentGames() {
    if (!username || syncingGames || !hasNativeHost()) return;
    syncingGames = true;
    syncError = "";
    try {
      const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      weeklyGames = await getChessComRapidSince(username, since);
      restoreWeeklyReport();
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
    } finally {
      syncingGames = false;
    }
  }

  function currentGameIds(): string[] {
    return weeklyGames.map(gameId).sort();
  }

  function restoreWeeklyReport() {
    try {
      const cached = JSON.parse(
        localStorage.getItem(WEEKLY_REPORT_STORAGE_KEY) ?? "null",
      ) as CachedWeeklyReport | null;
      if (cached?.username === username) {
        insights = reconcileWeeklyInsights(currentGameIds(), cached.insights);
        completed = 0;
        return;
      }
    } catch {
      localStorage.removeItem(WEEKLY_REPORT_STORAGE_KEY);
    }
    insights = [];
    completed = 0;
  }

  function persistWeeklyReport() {
    const cached: CachedWeeklyReport = {
      username,
      gameIds: currentGameIds(),
      generatedAtMs: Date.now(),
      insights,
    };
    localStorage.setItem(WEEKLY_REPORT_STORAGE_KEY, JSON.stringify(cached));
  }

  async function analyzeWeek() {
    if (analyzing || syncingGames || !weeklyGames.length) return;
    if (!hasNativeHost()) {
      analysisError = "Weekly analysis needs the ChessCave desktop app and Stockfish.";
      return;
    }
    analysisError = "";
    skippedGames = 0;
    completed = 0;
    const analyzedIds = new Set(insights.map((insight) => insight.id));
    const missing = weeklyGames.filter((game) => !analyzedIds.has(gameId(game)));
    const queue = missing.length ? missing : weeklyGames;
    analysisTotal = queue.length;
    analyzing = true;
    cancelRequested = false;

    try {
      const engine = await getEngineStatus();
      if (!engine.available) throw new Error(engine.message);
      for (const source of queue) {
        if (cancelRequested) break;
        const summary = summarizeChessComGame(source, username);
        currentOpponent = summary.opponent.username;
        positionProgress = null;
        try {
          const game = parsePgn(source.pgn);
          const review = await reviewGame(game);
          const side: Side = summary.side === "white" ? "w" : "b";
          const insight = buildWeeklyGameInsight(game, review, side, {
            id: gameId(source),
            url: source.url,
            opponent: summary.opponent.username,
            endTime: source.endTime,
            outcome: summary.outcome,
          });
          insights = [
            ...insights.filter((existing) => existing.id !== insight.id),
            insight,
          ];
          persistWeeklyReport();
        } catch {
          skippedGames += 1;
        }
        completed += 1;
      }
      if (insights.length) persistWeeklyReport();
      if (skippedGames) {
        analysisError = `${skippedGames} game${skippedGames === 1 ? "" : "s"} could not be analyzed.`;
      }
    } catch (error) {
      analysisError = error instanceof Error ? error.message : String(error);
    } finally {
      analyzing = false;
      currentOpponent = "";
      positionProgress = null;
    }
  }

  function stopAnalysis() {
    cancelRequested = true;
  }

  async function openStudy(insight: WeeklyGameInsight) {
    const source = gameById.get(insight.id);
    if (!source) return;
    const game = parsePgn(source.pgn);
    localStorage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        pgn: source.pgn,
        currentPly: game.moves.length,
        sourceUrl: source.url,
      }),
    );
    await goto("/study");
  }

  async function replayMoment(
    insight: WeeklyGameInsight,
    moment: WeeklyMoment | null,
    label: string,
  ) {
    const source = gameById.get(insight.id);
    if (!source || !moment) return;
    const launch: PracticeLaunch = {
      pgn: source.pgn,
      side: insight.side,
      startPly: moment.ply - 1,
      title: label,
      createdAtMs: Date.now(),
    };
    localStorage.setItem(PRACTICE_LAUNCH_STORAGE_KEY, JSON.stringify(launch));
    localStorage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        pgn: source.pgn,
        currentPly: moment.ply - 1,
        sourceUrl: source.url,
      }),
    );
    await goto("/practice/conversion");
  }

  function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp * 1000));
  }

  function phaseSummary(insight: WeeklyGameInsight): string {
    const available = Object.entries(insight.phaseAccuracy)
      .filter((entry): entry is [string, number] => entry[1] !== null)
      .sort((left, right) => right[1] - left[1]);
    if (!available.length) return "Short game";
    return `${available[0][0]} ${available[0][1].toFixed(1)}`;
  }

  function classificationLabel(value: string): string {
    return value[0].toUpperCase() + value.slice(1);
  }
</script>

<svelte:head>
  <title>Weekly Training — ChessCave</title>
  <meta
    name="description"
    content="Review the best and most instructive Rapid games from your last seven days."
  />
</svelte:head>

<div class="app-shell">
  {#snippet headerActions()}
    <div class="practice-links">
      <a class="codex-link" href="/play/codex">Play with Codex</a>
      <a class="conversion-link" href="/practice/conversion">Conversion drill</a>
    </div>
  {/snippet}

  <AppHeader
    active="practice"
    title="Weekly Training Room"
    subtitle="Your last seven days of Rapid"
    actions={headerActions}
  />

  <main>
    {#if hydrated && !username}
      <section class="empty-state">
        <span class="eyebrow">RAPID · LAST 7 DAYS</span>
        <h2>Connect your Chess.com games first.</h2>
        <p>The weekly room uses the Rapid games already synced on your home dashboard.</p>
        <a class="primary-link" href="/">Connect on Home</a>
      </section>
    {:else if hydrated && syncingGames && !weeklyGames.length}
      <section class="empty-state syncing-state">
        <span class="spinner" aria-hidden="true"></span>
        <h2>Gathering the full seven-day window…</h2>
        <p>ChessCave is loading every standard Rapid game, not only the dashboard preview.</p>
      </section>
    {:else if hydrated && !weeklyGames.length}
      <section class="empty-state">
        <span class="eyebrow">RAPID · LAST 7 DAYS</span>
        <h2>No recent Rapid games yet.</h2>
        <p>Play a Rapid game, refresh the Home dashboard, and it will appear here.</p>
        {#if syncError}<p class="sync-error">{syncError}</p>{/if}
        <a class="primary-link" href="/">Refresh games</a>
      </section>
    {:else if hydrated}
      <div class="weekly-shell">
        <section class="week-hero">
          <div>
            <span class="eyebrow">YOUR TRAINING WEEK</span>
            <h2>{weeklyGames.length} Rapid game{weeklyGames.length === 1 ? "" : "s"} ready</h2>
            <p>
              Ranked by the quality of your decisions—not simply whether the game
              ended as a win or loss.
            </p>
            {#if syncingGames}
              <small class="sync-note">Checking Chess.com for the complete week…</small>
            {:else if syncError}
              <small class="sync-note warning">Using cached dashboard games · {syncError}</small>
            {/if}
          </div>
          {#if analyzing}
            <div class="analysis-progress">
              <div class="progress-copy">
                <span>Analyzing {Math.min(completed + 1, analysisTotal)} of {analysisTotal}</span>
                <strong>{currentOpponent ? `vs ${currentOpponent}` : "Preparing Stockfish"}</strong>
                {#if positionProgress}
                  <small>{positionProgress.completed}/{positionProgress.total} positions</small>
                {/if}
              </div>
              <div class="progress-track">
                <i style={`width: ${analysisTotal ? (completed / analysisTotal) * 100 : 0}%`}></i>
              </div>
              <button type="button" onclick={stopAnalysis}>Stop after this game</button>
            </div>
          {:else}
            <button class="analyze-button" type="button" disabled={syncingGames} onclick={analyzeWeek}>
              {syncingGames
                ? "Loading complete week…"
                : !insights.length
                  ? "Analyze my week"
                  : insights.length < weeklyGames.length
                    ? `Analyze ${weeklyGames.length - insights.length} remaining`
                    : "Refresh weekly analysis"}
            </button>
          {/if}
        </section>

        {#if analysisError}
          <p class="analysis-error">{analysisError}</p>
        {/if}

        {#if insights.length}
          <section class="week-metrics" aria-label="Weekly overview">
            <div>
              <span>Analyzed</span>
              <strong>{insights.length}</strong>
              <small>Rapid games</small>
            </div>
            <div>
              <span>Average accuracy</span>
              <strong>{weekAccuracy?.toFixed(1) ?? "—"}</strong>
              <small>Across both results</small>
            </div>
            <div>
              <span>Serious errors</span>
              <strong>{seriousErrors}</strong>
              <small>Mistakes, misses, blunders</small>
            </div>
            <div>
              <span>Strongest phase</span>
              <strong class="phase-value">{report.strongestPhase ? classificationLabel(report.strongestPhase) : "—"}</strong>
              <small>Weighted by moves played</small>
            </div>
          </section>

          <section class="strength-section">
            <header>
              <span class="eyebrow">WEEKLY SIGNALS</span>
              <h2>What your games say</h2>
              <p>These are signals from the analyzed sample, not permanent labels.</p>
            </header>
            <div class="strength-grid">
              {#each report.strengths as strength}
                <article>
                  <div class="strength-score">{Math.round(strength.value)}</div>
                  <div>
                    <strong>{strength.title}</strong>
                    <p>{strength.detail}</p>
                  </div>
                </article>
              {/each}
            </div>
          </section>

          <section class="groups-grid">
            <div class="game-group best-group">
              <header>
                <span class="group-mark">01</span>
                <div>
                  <span class="eyebrow">BEST GAMES</span>
                  <h2>Your cleanest chess</h2>
                </div>
              </header>
              <div class="game-list">
                {#each report.bestGames as insight}
                  <article class="game-card">
                    <div class="card-heading">
                      <div>
                        <span>{formatDate(insight.endTime)} · {insight.outcome}</span>
                        <strong>vs {insight.opponent}</strong>
                      </div>
                      <div class="accuracy-orb">
                        <strong>{insight.accuracy.toFixed(1)}</strong>
                        <span>accuracy</span>
                      </div>
                    </div>
                    <div class="card-facts">
                      <span>{phaseSummary(insight)}</span>
                      <span>{insight.strongMoves} strong moves</span>
                      <span>{insight.seriousErrors} serious errors</span>
                    </div>
                    {#if insight.bestMoment}
                      <div class="moment-note positive">
                        <span>KEY DECISION</span>
                        <strong>{Math.ceil(insight.bestMoment.ply / 2)}{insight.bestMoment.ply % 2 === 0 ? "…" : "."} {insight.bestMoment.san}</strong>
                        <small>{classificationLabel(insight.bestMoment.classification)}</small>
                      </div>
                    {/if}
                    <div class="card-actions">
                      <button type="button" onclick={() => openStudy(insight)}>Review game</button>
                      <button
                        class="primary"
                        type="button"
                        disabled={!insight.bestMoment}
                        onclick={() => replayMoment(insight, insight.bestMoment, "Replay your best decision")}
                      >Replay position</button>
                    </div>
                  </article>
                {/each}
              </div>
            </div>

            <div class="game-group work-group">
              <header>
                <span class="group-mark">02</span>
                <div>
                  <span class="eyebrow">MOST INSTRUCTIVE</span>
                  <h2>Where points escaped</h2>
                </div>
              </header>
              <div class="game-list">
                {#each report.needsWork as insight}
                  <article class="game-card">
                    <div class="card-heading">
                      <div>
                        <span>{formatDate(insight.endTime)} · {insight.outcome}</span>
                        <strong>vs {insight.opponent}</strong>
                      </div>
                      <div class="accuracy-orb warm">
                        <strong>{insight.accuracy.toFixed(1)}</strong>
                        <span>accuracy</span>
                      </div>
                    </div>
                    <div class="card-facts">
                      <span>{phaseSummary(insight)}</span>
                      <span>{insight.seriousErrors} serious errors</span>
                      <span>quality {insight.qualityScore.toFixed(0)}</span>
                    </div>
                    {#if insight.criticalMoment}
                      <div class="moment-note critical">
                        <span>TRAIN THIS MOMENT</span>
                        <strong>{Math.ceil(insight.criticalMoment.ply / 2)}{insight.criticalMoment.ply % 2 === 0 ? "…" : "."} {insight.criticalMoment.san}</strong>
                        <small>{Math.round(insight.criticalMoment.expectedPointsLost * 100)} expected-score points lost</small>
                      </div>
                    {/if}
                    <div class="card-actions">
                      <button type="button" onclick={() => openStudy(insight)}>Review game</button>
                      <button
                        class="primary warm"
                        type="button"
                        disabled={!insight.criticalMoment}
                        onclick={() => replayMoment(insight, insight.criticalMoment, "Find a better plan")}
                      >Replay position</button>
                    </div>
                  </article>
                {/each}
              </div>
            </div>
          </section>

          <section class="all-games">
            <header>
              <span class="eyebrow">ALL ANALYZED GAMES</span>
              <span>Quality combines accuracy, serious errors, and result.</span>
            </header>
            <div class="table-head">
              <span>Game</span><span>Result</span><span>Accuracy</span><span>Quality</span><span></span>
            </div>
            {#each report.games as insight}
              <div class="table-row">
                <span><strong>vs {insight.opponent}</strong><small>{formatDate(insight.endTime)}</small></span>
                <span class={`outcome ${insight.outcome}`}>{insight.outcome}</span>
                <span>{insight.accuracy.toFixed(1)}</span>
                <span>{insight.qualityScore.toFixed(0)}</span>
                <button type="button" onclick={() => openStudy(insight)}>Open</button>
              </div>
            {/each}
          </section>
        {:else if !analyzing}
          <section class="before-analysis">
            <div class="method-card">
              <span class="eyebrow">HOW IT WORKS</span>
              <ol>
                <li><strong>Review</strong><span>Stockfish evaluates each Rapid game once and reuses the cache.</span></li>
                <li><strong>Group</strong><span>Clean games and instructive games are ranked independently of result.</span></li>
                <li><strong>Replay</strong><span>Take over at a key decision with engine help hidden.</span></li>
              </ol>
            </div>
          </section>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .app-shell {
    height: 100%;
    background:
      radial-gradient(circle at 12% 8%, rgba(204, 107, 80, 0.09), transparent 25%),
      radial-gradient(circle at 88% 24%, rgba(119, 129, 106, 0.09), transparent 28%),
      var(--paper);
  }

  main {
    height: calc(100% - 69px);
    overflow: auto;
  }

  .practice-links {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .codex-link,
  .conversion-link,
  .primary-link {
    display: inline-flex;
    justify-content: center;
    padding: 8px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    font-size: 11px;
    font-weight: 680;
    text-decoration: none;
  }

  .weekly-shell {
    width: min(1320px, 100%);
    margin: 0 auto;
    padding: 30px 32px 60px;
  }

  .eyebrow,
  .moment-note > span {
    color: var(--coral-dark);
    font-size: 10px;
    font-weight: 780;
    letter-spacing: 0.13em;
  }

  h2 {
    margin: 7px 0 0;
    font-family: var(--display);
    font-size: 27px;
    font-variation-settings: "opsz" 28, "wght" 620;
  }

  .week-hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 145px;
    padding: 24px 28px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: rgba(255, 253, 248, 0.82);
    box-shadow: 0 16px 42px rgba(66, 52, 42, 0.06);
  }

  .week-hero p,
  .strength-section header p,
  .empty-state p {
    max-width: 620px;
    margin: 9px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .analyze-button {
    padding: 11px 17px;
    border: 0;
    border-radius: 9px;
    color: white;
    background: var(--coral-dark);
    font-weight: 720;
    cursor: pointer;
  }

  .analysis-progress {
    display: grid;
    gap: 9px;
    width: min(350px, 42%);
  }

  .progress-copy {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 12px;
    font-size: 11px;
  }

  .progress-copy span,
  .progress-copy small {
    color: var(--muted);
  }

  .progress-copy small {
    grid-column: 1 / -1;
  }

  .progress-track {
    height: 5px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--line);
  }

  .progress-track i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--coral);
    transition: width 180ms ease;
  }

  .analysis-progress button {
    justify-self: end;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
    font-size: 10px;
    text-decoration: underline;
    cursor: pointer;
  }

  .analysis-error {
    margin: 12px 4px 0;
    color: var(--danger);
    font-size: 11px;
  }

  .week-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 22px 0;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: rgba(255, 253, 248, 0.68);
  }

  .week-metrics > div {
    display: grid;
    gap: 3px;
    padding: 17px 20px;
  }

  .week-metrics > div + div {
    border-left: 1px solid var(--line);
  }

  .week-metrics span,
  .week-metrics small {
    color: var(--muted);
    font-size: 9px;
    text-transform: uppercase;
  }

  .week-metrics strong {
    font-family: var(--display);
    font-size: 25px;
  }

  .week-metrics .phase-value {
    font-size: 20px;
  }

  .strength-section {
    display: grid;
    grid-template-columns: 0.75fr 1.25fr;
    gap: 28px;
    margin: 36px 0 44px;
  }

  .strength-grid {
    display: grid;
    gap: 9px;
  }

  .strength-grid article {
    display: flex;
    gap: 15px;
    align-items: center;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--pearl-raised);
  }

  .strength-score {
    display: grid;
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 50%;
    color: var(--sage);
    background: var(--sage-soft);
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
  }

  .strength-grid strong {
    font-size: 13px;
  }

  .strength-grid p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .groups-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .game-group > header {
    display: flex;
    gap: 13px;
    align-items: center;
    margin-bottom: 13px;
  }

  .game-group h2 {
    font-size: 22px;
  }

  .group-mark {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 1px solid #b9c3aa;
    border-radius: 50%;
    color: var(--sage);
    font-family: var(--display);
    font-size: 13px;
  }

  .work-group .group-mark {
    border-color: #d7a28f;
    color: var(--coral-dark);
  }

  .game-list {
    display: grid;
    gap: 13px;
  }

  .game-card {
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: rgba(255, 253, 248, 0.88);
    box-shadow: 0 10px 28px rgba(66, 52, 42, 0.04);
  }

  .card-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .card-heading > div:first-child {
    display: grid;
    gap: 4px;
  }

  .card-heading span {
    color: var(--muted);
    font-size: 9px;
    text-transform: uppercase;
  }

  .card-heading > div:first-child strong {
    font-family: var(--display);
    font-size: 17px;
  }

  .accuracy-orb {
    display: grid;
    width: 61px;
    height: 61px;
    place-content: center;
    border: 1px solid #bdc6b1;
    border-radius: 50%;
    color: var(--sage);
    text-align: center;
  }

  .accuracy-orb.warm {
    border-color: #dbb2a3;
    color: var(--coral-dark);
  }

  .accuracy-orb strong {
    font-family: var(--display);
    font-size: 16px;
  }

  .accuracy-orb span {
    font-size: 7px;
  }

  .card-facts {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    margin: 15px 0;
  }

  .card-facts span {
    padding: 5px 7px;
    border-radius: 6px;
    color: var(--muted);
    background: var(--paper);
    font-size: 9px;
  }

  .moment-note {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    padding: 11px 12px;
    border-left: 3px solid var(--sage);
    border-radius: 0 8px 8px 0;
    background: var(--sage-soft);
  }

  .moment-note.critical {
    border-color: var(--coral);
    background: var(--coral-soft);
  }

  .moment-note > span {
    grid-column: 1 / -1;
    color: var(--sage);
    font-size: 8px;
  }

  .moment-note.critical > span {
    color: var(--coral-dark);
  }

  .moment-note strong {
    font-size: 12px;
  }

  .moment-note small {
    color: var(--muted);
    font-size: 9px;
  }

  .card-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .card-actions button,
  .table-row button {
    padding: 7px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    color: var(--ink-soft);
    background: transparent;
    font-size: 10px;
    font-weight: 650;
    cursor: pointer;
  }

  .card-actions button.primary {
    border-color: var(--sage);
    color: white;
    background: var(--sage);
  }

  .card-actions button.primary.warm {
    border-color: var(--coral-dark);
    background: var(--coral-dark);
  }

  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .all-games {
    margin-top: 42px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: rgba(255, 253, 248, 0.7);
  }

  .all-games > header {
    display: flex;
    justify-content: space-between;
    padding: 15px 18px;
    border-bottom: 1px solid var(--line);
  }

  .all-games > header > span:last-child,
  .table-head {
    color: var(--muted);
    font-size: 9px;
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 1.4fr 0.7fr 0.7fr 0.7fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px 18px;
  }

  .table-head {
    text-transform: uppercase;
  }

  .table-row {
    border-top: 1px solid var(--line);
    font-size: 11px;
  }

  .table-row > span:first-child {
    display: grid;
    gap: 2px;
  }

  .table-row small {
    color: var(--muted);
  }

  .outcome {
    width: fit-content;
    padding: 4px 7px;
    border-radius: 999px;
    background: var(--paper);
    text-transform: capitalize;
  }

  .outcome.win { color: var(--sage); background: var(--sage-soft); }
  .outcome.loss { color: var(--coral-dark); background: var(--coral-soft); }

  .before-analysis {
    display: grid;
    place-items: center;
    min-height: 320px;
  }

  .method-card {
    width: min(680px, 100%);
    padding: 26px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgba(255, 253, 248, 0.72);
  }

  .method-card ol {
    display: grid;
    gap: 14px;
    margin: 18px 0 0;
    padding: 0;
    list-style: none;
  }

  .method-card li {
    display: grid;
    grid-template-columns: 75px 1fr;
    gap: 12px;
    color: var(--muted);
    font-size: 12px;
  }

  .method-card strong {
    color: var(--ink);
  }

  .empty-state {
    width: min(560px, calc(100% - 32px));
    margin: 12vh auto 0;
    padding: 34px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--pearl-raised);
    text-align: center;
    box-shadow: 0 18px 50px rgba(66, 52, 42, 0.08);
  }

  .empty-state .primary-link {
    margin-top: 20px;
  }

  .sync-note {
    display: block;
    margin-top: 9px;
    color: var(--sage);
    font-size: 10px;
  }

  .sync-note.warning {
    color: var(--ochre);
  }

  .sync-error {
    color: var(--danger) !important;
  }

  .syncing-state .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--line);
    border-top-color: var(--coral);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    .weekly-shell { padding: 20px 16px 50px; }
    .week-metrics { grid-template-columns: 1fr 1fr; }
    .week-metrics > div:nth-child(3) { border-left: 0; border-top: 1px solid var(--line); }
    .week-metrics > div:nth-child(4) { border-top: 1px solid var(--line); }
    .strength-section, .groups-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 620px) {
    main { height: calc(100% - 63px); }
    .week-hero { display: grid; gap: 18px; }
    .analysis-progress { width: 100%; }
    .week-metrics { grid-template-columns: 1fr; }
    .week-metrics > div + div { border-top: 1px solid var(--line); border-left: 0; }
    .table-head { display: none; }
    .table-row { grid-template-columns: 1.4fr 0.7fr 0.7fr auto; }
    .table-row > span:nth-child(4) { display: none; }
    .all-games > header > span:last-child { display: none; }
  }
</style>
