<script lang="ts">
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import { legalPatchMove } from "$lib/patches/patches";
  import type { PatchCard } from "$lib/patches/types";

  let {
    contextKey,
    fen,
    orientation,
    positionLabel,
    playedMove,
    engineMove,
    draft,
    saved,
    busy,
    saving,
    error,
    initialMistake,
    initialCorrection,
    onGenerate,
    onSave,
    onReset,
    onDraftChange,
  }: {
    contextKey: string;
    fen: string;
    orientation: "white" | "black";
    positionLabel: string;
    playedMove: string | null;
    engineMove: string | null;
    draft: PatchCard | null;
    saved: boolean;
    busy: boolean;
    saving: boolean;
    error: string;
    initialMistake: string;
    initialCorrection: string;
    onGenerate: (mistake: string, correction: string) => void;
    onSave: () => void;
    onReset: () => void;
    onDraftChange: (mistake: string, correction: string) => void;
  } = $props();

  let mistake = $state("");
  let correction = $state("");
  let previousContext = "";
  const maximumReflectionLength = 600;
  const verifiedMove = $derived(
    engineMove ? legalPatchMove(fen, engineMove)?.san ?? engineMove : null,
  );
  const readyToCreate = $derived(Boolean(mistake.trim() && correction.trim()));
  const hasReflection = $derived(Boolean(mistake.trim() || correction.trim()));

  $effect(() => {
    if (contextKey === previousContext) return;
    previousContext = contextKey;
    mistake = initialMistake;
    correction = initialCorrection;
  });

  function regenerate() {
    onReset();
  }

  function startAnother() {
    mistake = "";
    correction = "";
    onDraftChange("", "");
    onReset();
  }
</script>

<div class="patch-composer" role="tabpanel">
  <div class="patch-source">
    <div class="source-copy">
      <span>PATCH THIS DECISION</span>
      <strong>{positionLabel}</strong>
      <small>
        {playedMove ? `You played ${playedMove}` : "Choose the move you want to remember"}
      </small>
      <div class="decision-facts">
        {#if playedMove}<span>Played <strong>{playedMove}</strong></span>{/if}
        {#if verifiedMove}<span>Stockfish <strong>{verifiedMove}</strong></span>{/if}
      </div>
    </div>
    <div class="source-board" aria-label="Position saved with this patch">
      <ChessBoard
        {fen}
        flipped={orientation === "black"}
        compact
        onSquareClick={() => {}}
      />
    </div>
  </div>

  {#if saved}
    <section class="saved-state" aria-live="polite">
      <span class="saved-mark" aria-hidden="true">✓</span>
      <div>
        <span>PATCH SAVED</span>
        <h2>Ready to practice.</h2>
        <p>This position is due now. Recall the move on the board before reading the lesson.</p>
      </div>
      <div class="saved-actions">
        <button type="button" class="quiet" onclick={startAnother}>Create another</button>
        <a href="/drill">Open Drill</a>
      </div>
    </section>
  {:else if draft}
    <section class="card-preview" aria-label="Flashcard preview">
      <div class="preview-kicker">
        <span>FLASHCARD PREVIEW</span>
        <small>Find the move</small>
      </div>
      <h2>{draft.quiz.prompt}</h2>
      <div class="answer-line">
        <span>Accepted move</span>
        <strong>{draft.quiz.acceptedMoves.map((move) => move.san).join(" · ")}</strong>
      </div>
      <div class="diagnosis-preview">
        <span>YOUR DIAGNOSIS</span>
        <p>{draft.diagnosis.mistake}</p>
        <small>Your correction: {draft.diagnosis.proposedCorrection}</small>
      </div>
      {#each draft.revealBlocks as block}
        {#if block.type === "explanation"}
          <div class="reveal-block">
            <span>WHY</span>
            <p>{block.text}</p>
          </div>
        {:else if block.type === "principle"}
          <div class="reveal-block principle">
            <span>PATCH</span>
            <p>{block.text}</p>
          </div>
        {:else if block.type === "variation"}
          <div class="variation-block">
            <span>LINE</span>
            <p>{block.moves.join(" ")}</p>
          </div>
        {/if}
      {/each}
      {#if error}<p class="patch-error" role="alert">{error}</p>{/if}
      <div class="preview-actions">
        <button type="button" class="quiet" disabled={saving} onclick={regenerate}>Revise</button>
        <button type="button" class="primary" disabled={saving} onclick={onSave}>
          {saving ? "Saving…" : "Save patch"}
        </button>
      </div>
    </section>
  {:else}
    <form
      class="patch-questions"
      onsubmit={(event) => {
        event.preventDefault();
        onGenerate(mistake, correction);
      }}
    >
      <div class="question">
        <label for="patch-mistake">What mistake did you make?</label>
        <small>Describe what you saw, missed, or assumed at this moment.</small>
        <textarea
          id="patch-mistake"
          value={mistake}
          oninput={(event) => {
            mistake = event.currentTarget.value;
            onDraftChange(mistake, correction);
          }}
          rows="3"
          maxlength={maximumReflectionLength}
          placeholder="I focused on my attack and missed their threat…"
          disabled={busy}
        ></textarea>
      </div>
      <div class="question">
        <label for="patch-correction">What was the right move or idea?</label>
        <small>Give a legal move if you know it, then describe the idea you want to recognize.</small>
        <textarea
          id="patch-correction"
          value={correction}
          oninput={(event) => {
            correction = event.currentTarget.value;
            onDraftChange(mistake, correction);
          }}
          rows="3"
          maxlength={maximumReflectionLength}
          placeholder="A move such as Nf3, or describe the idea"
          disabled={busy}
        ></textarea>
      </div>
      {#if error}<p class="patch-error" role="alert">{error}</p>{/if}
      <div class:ready={readyToCreate} class="creation-status" role="status">
        <span></span>
        {#if busy}
          Codex is shaping your reflection into one board-first drill…
        {:else if readyToCreate}
          {verifiedMove ? `Ready · Stockfish will verify against ${verifiedMove}` : "Ready · ChessCave will verify the position first"}
        {:else}
          {hasReflection
            ? "Draft kept with this position · complete both reflections to create the patch."
            : "Complete both reflections to create the patch."}
        {/if}
      </div>
      <button
        type="submit"
        class="generate"
        disabled={busy || !readyToCreate}
      >
        {busy ? "Designing the flashcard…" : "Create with Codex"}
      </button>
    </form>
  {/if}
</div>

<style>
  .patch-composer {
    min-height: 0;
    overflow-y: auto;
    padding: 18px 20px 22px;
    scrollbar-color: var(--line-strong) transparent;
  }

  .patch-source {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 116px;
    gap: 16px;
    align-items: center;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--line);
  }

  .source-copy {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .source-copy > span,
  .preview-kicker > span,
  .reveal-block > span,
  .variation-block > span {
    color: var(--coral-dark);
    font-size: 8px;
    font-weight: 780;
    letter-spacing: 0.12em;
  }

  .source-copy > strong {
    overflow: hidden;
    font-family: var(--display);
    font-size: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-copy small,
  .preview-kicker small,
  .question small {
    color: var(--muted);
    font-size: 9px;
    line-height: 1.4;
  }

  .decision-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 3px;
  }

  .decision-facts span {
    padding: 4px 7px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
    background: var(--paper);
    font-size: 8px;
  }

  .decision-facts strong {
    margin-left: 2px;
    color: var(--ink-soft);
  }

  .source-board {
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
  }

  .patch-questions {
    display: grid;
    gap: 18px;
    padding-top: 22px;
  }

  .question {
    display: grid;
    gap: 8px;
  }

  label {
    color: var(--ink);
    font-family: var(--display);
    font-size: 16px;
    font-weight: 590;
  }

  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    padding: 10px 11px;
    color: var(--ink);
    background: var(--pearl-raised);
    font-family: var(--interface);
    font-size: 12px;
    line-height: 1.5;
  }

  textarea:focus {
    border-color: var(--coral-dark);
    outline: 0;
    box-shadow: 0 0 0 2px var(--coral-soft);
  }

  .generate,
  .primary,
  .quiet {
    min-height: 40px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .generate,
  .primary {
    border: 1px solid var(--ink);
    color: var(--pearl-raised);
    background: var(--ink);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .creation-status {
    display: flex;
    gap: 7px;
    align-items: center;
    min-height: 20px;
    color: var(--muted);
    font-size: 9px;
    line-height: 1.4;
  }

  .creation-status > span {
    flex: 0 0 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--faint);
  }

  .creation-status.ready > span {
    background: var(--sage);
  }

  .card-preview {
    display: grid;
    gap: 16px;
    padding-top: 20px;
  }

  .preview-kicker {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .card-preview h2 {
    margin: 0;
    font-family: var(--display);
    font-size: 24px;
    font-variation-settings: "opsz" 28, "wght" 570;
    line-height: 1.13;
  }

  .answer-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 12px;
    border: 1px solid #bec7b3;
    border-radius: 8px;
    background: var(--sage-soft);
  }

  .answer-line span {
    color: var(--muted);
    font-size: 9px;
  }

  .answer-line strong {
    color: var(--sage);
    font-family: var(--display);
    font-size: 16px;
  }

  .diagnosis-preview {
    padding: 12px 13px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
  }

  .diagnosis-preview > span,
  .saved-state > div > span {
    color: var(--coral-dark);
    font-size: 8px;
    font-weight: 780;
    letter-spacing: 0.12em;
  }

  .diagnosis-preview p {
    margin: 6px 0 3px;
    color: var(--ink-soft);
    font-family: var(--display);
    font-size: 13px;
    line-height: 1.5;
  }

  .diagnosis-preview small {
    color: var(--muted);
    font-size: 9px;
  }

  .reveal-block,
  .variation-block {
    padding-top: 13px;
    border-top: 1px solid var(--line);
  }

  .reveal-block p,
  .variation-block p {
    margin: 6px 0 0;
    color: var(--ink-soft);
    font-family: var(--display);
    font-size: 13px;
    line-height: 1.5;
  }

  .reveal-block.principle {
    padding: 12px;
    border: 0;
    border-left: 3px solid var(--coral);
    background: var(--coral-soft);
  }

  .patch-error {
    margin: 0;
    color: var(--danger);
    font-size: 10px;
    line-height: 1.45;
  }

  .preview-actions {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 8px;
  }

  .quiet {
    border: 1px solid var(--line-strong);
    color: var(--ink-soft);
    background: transparent;
  }

  .saved-state {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 13px;
    align-items: start;
    padding-top: 26px;
  }

  .saved-mark {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 50%;
    color: var(--pearl-raised);
    background: var(--sage);
    font-size: 17px;
    font-weight: 750;
  }

  .saved-state h2 {
    margin: 5px 0 0;
    font-family: var(--display);
    font-size: 24px;
    font-variation-settings: "opsz" 28, "wght" 570;
  }

  .saved-state p {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.55;
  }

  .saved-actions {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 8px;
    margin-top: 10px;
  }

  .saved-actions a {
    display: grid;
    min-height: 40px;
    place-items: center;
    border: 1px solid var(--ink);
    border-radius: 8px;
    color: var(--pearl-raised);
    background: var(--ink);
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
  }

  @media (max-width: 1120px) {
    .patch-source {
      grid-template-columns: minmax(0, 1fr) 96px;
    }
  }
</style>
