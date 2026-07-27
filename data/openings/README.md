# Opening data

The five source TSV files in `source/` come from
[`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings)
at revision `51b886249b9e418498d25b6e39b926c3de99c29a` (2026-07-22).

The collection is dedicated to the public domain under CC0 1.0. Its full
notice is preserved in `COPYING.txt`.

Run this after intentionally updating the pinned source files:

```sh
bun run build:openings
```

The generator resolves every PGN line into a normalized four-field FEN key and
writes the compact runtime index to
`static/openings/lichess-openings.json`. ChessCave can then recognize openings
offline, including positions reached by transposition.
