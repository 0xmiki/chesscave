# Game Review data model

ChessCave treats a review as a durable result, not a live view concern.
Importing or branching a game creates one immutable sequence of positions. The
desktop host analyzes that sequence once and saves the complete result under:

```text
app-local-data/reviews/v1/<sha256>.json
```

The key covers the ordered FEN/played-move sequence, schema version, Stockfish
path, node budget, and MultiPV setting. Opening an identical game with identical
settings is therefore a disk read. The sparkle button is the explicit
force-re-review action.

## Snapshot

```text
GameReview
├─ schemaVersion
├─ gameKey
├─ engine
├─ nodesPerPosition
├─ multiPv
├─ createdAtMs
├─ cached
├─ model
├─ positions[]
│  ├─ ply + fen
│  ├─ bestMove
│  ├─ elapsedMs
│  └─ lines[]
│     ├─ multipv + depth
│     ├─ scoreCp | scoreMate
│     ├─ wdl [white win, draw, white loss]
│     └─ moves[]
├─ moves[]
│  ├─ ply + san + uci + color
│  ├─ classification
│  ├─ expectedPointsBefore
│  ├─ expectedPointsAfter
│  ├─ expectedPointsLost
│  ├─ estimatedAccuracy
│  └─ bestMove
└─ summary
   ├─ whiteAccuracy
   ├─ blackAccuracy
   └─ classifications
```

All engine evaluations and WDL triples are normalized to White's perspective.
For a Black move, move quality converts both positions back to Black's expected
points before calculating the loss.

`MoveReview.bestMove` is copied from the analyzed position immediately before
the played move. The board uses it for the green best-alternative arrow when it
differs from the played UCI move. It deliberately does not use the next
`PositionReview.bestMove`, which belongs to the opponent's reply position.

## Review pass

The engine is initialized once with two threads, a 128 MB hash, MultiPV, and
`UCI_ShowWDL`. Each FEN receives the same `go nodes` budget. Progress is emitted
as `chesscave://review-progress`; the review is exposed to the webview only as a
complete snapshot and is then persisted.

Fixed nodes mirror Chess.com's published reason for its faster whole-game
review architecture: comparable work for every ply instead of an unstable
depth or time budget.

## Classifications

ChessCave uses Stockfish WDL as its local expected-points model. It then applies
Chess.com's published Classification V2 expected-points-loss boundaries:

| Classification | Expected points lost |
| --- | ---: |
| Best | engine choice |
| Excellent | 0.00–0.02 |
| Good | 0.02–0.05 |
| Inaccuracy | 0.05–0.10 |
| Mistake | 0.10–0.20 |
| Blunder | 0.20–1.00 |

A best move becomes `great` when the second candidate loses at least 0.10
expected points and the player was not already overwhelmingly winning. Book
moves are identified independently from the engine review by the bundled
Lichess opening-position index. ChessCave marks the line through the deepest
named position as book theory, while leaving the underlying Stockfish
classification untouched. Miss and Brilliant still need tactical-opportunity
and sound-sacrifice detection respectively; the model deliberately does not
invent those labels yet.

Chess.com's rating-conditioned Expected Points curve and CAPS2 accuracy
transformation are not public. `estimatedAccuracy` is consequently named as an
estimate and is never presented as Chess.com's proprietary Accuracy score.

Published behavior used as design input:

- <https://support.chess.com/en/articles/8584089-how-does-game-review-work>
- <https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc>
- <https://www.chess.com/news/view/stockfish-16-on-chesscom>
