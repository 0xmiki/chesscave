<script lang="ts">
  let {
    scoreCp = null,
    scoreMate = null,
    flipped = false,
  }: {
    scoreCp?: number | null;
    scoreMate?: number | null;
    flipped?: boolean;
  } = $props();

  const whitePercent = $derived.by(() => {
    if (scoreMate !== null) return scoreMate > 0 ? 97 : 3;
    if (scoreCp === null) return 50;
    return Math.max(4, Math.min(96, 50 + Math.tanh(scoreCp / 420) * 46));
  });

  const label = $derived(
    scoreMate !== null
      ? `M${Math.abs(scoreMate)}`
      : scoreCp === null
        ? "—"
        : `${scoreCp >= 0 ? "+" : ""}${(scoreCp / 100).toFixed(1)}`,
  );
</script>

<div class:flipped class="evaluation" title="Evaluation from White's perspective">
  <div class="white" style={`height: ${whitePercent}%`}></div>
  <span class:in-white={whitePercent > 58} class="score">{label}</span>
</div>

<style>
  .evaluation {
    position: relative;
    align-self: stretch;
    width: 28px;
    min-height: 280px;
    overflow: hidden;
    border-radius: 5px;
    background: #20211f;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .evaluation.flipped {
    transform: rotate(180deg);
  }

  .white {
    position: absolute;
    bottom: 0;
    width: 100%;
    background: #efeee9;
    transition: height 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .score {
    position: absolute;
    top: 7px;
    left: 50%;
    transform: translateX(-50%);
    color: #f7f6f1;
    font-size: 10px;
    font-weight: 800;
    writing-mode: vertical-rl;
  }

  .score.in-white {
    top: auto;
    bottom: 7px;
    color: #20211f;
  }
</style>
