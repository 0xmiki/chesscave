import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Chess } from "chess.js";

const SOURCE_REVISION = "51b886249b9e418498d25b6e39b926c3de99c29a";
const sourceDirectory = resolve("data/openings/source");
const outputPath = resolve("static/openings/lichess-openings.json");
const volumes = ["a", "b", "c", "d", "e"];
const positions = new Map();
let sourceRows = 0;

for (const volume of volumes) {
  const input = await readFile(resolve(sourceDirectory, `${volume}.tsv`), "utf8");
  const [, ...rows] = input.trim().split(/\r?\n/);

  for (const row of rows) {
    const [eco, name, pgn] = row.split("\t");
    if (!eco || !name || !pgn) {
      throw new Error(`Invalid ${volume.toUpperCase()}-volume row: ${row}`);
    }

    const chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
    const moves = chess.history({ verbose: true });
    const epd = chess.fen().split(" ").slice(0, 4).join(" ");
    const uci = moves.map((move) => move.lan).join(" ");
    const candidate = [eco, name, moves.length, uci];
    const existing = positions.get(epd);

    // Some named positions have more than one transpositional route. Keep the
    // shortest canonical route, matching the source dataset's convention.
    if (!existing || candidate[2] < existing[2]) positions.set(epd, candidate);
    sourceRows += 1;
  }
}

const sortedPositions = Object.fromEntries(
  [...positions.entries()].sort(([left], [right]) => left.localeCompare(right)),
);
const payload = {
  schemaVersion: 1,
  source: {
    project: "lichess-org/chess-openings",
    revision: SOURCE_REVISION,
    license: "CC0-1.0",
    sourceRows,
    namedPositions: positions.size,
  },
  positions: sortedPositions,
};

await writeFile(outputPath, `${JSON.stringify(payload)}\n`);
console.log(
  `Wrote ${positions.size} named opening positions from ${sourceRows} source rows to ${outputPath}`,
);
