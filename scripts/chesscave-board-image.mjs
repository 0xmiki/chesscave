import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const BOARD_SIZE = 768;
const SQUARE_SIZE = BOARD_SIZE / 8;
const LIGHT_SQUARE = [238, 231, 215, 255];
const DARK_SQUARE = [137, 145, 118, 255];
const LAST_MOVE = [238, 181, 153, 158];
const pieceCache = new Map();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeIndexedPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("ChessCave piece artwork was not a PNG image.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const compressed = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error("Interlaced piece artwork is not supported.");
      }
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (
    width <= 0 ||
    height <= 0 ||
    ![4, 8].includes(bitDepth) ||
    colorType !== 3 ||
    !palette ||
    compressed.length === 0
  ) {
    throw new Error("ChessCave expected indexed PNG piece artwork.");
  }

  const source = inflateSync(Buffer.concat(compressed));
  const indexes = Buffer.alloc(width * height);
  const rowBytes = Math.ceil((width * bitDepth) / 8);
  let sourceOffset = 0;
  let previous = Buffer.alloc(rowBytes);

  for (let row = 0; row < height; row += 1) {
    const filter = source[sourceOffset];
    sourceOffset += 1;
    const current = Buffer.alloc(rowBytes);
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = source[sourceOffset + column];
      const left = column > 0 ? current[column - 1] : 0;
      const above = previous[column];
      const upperLeft = column > 0 ? previous[column - 1] : 0;
      if (filter === 0) current[column] = raw;
      else if (filter === 1) current[column] = (raw + left) & 0xff;
      else if (filter === 2) current[column] = (raw + above) & 0xff;
      else if (filter === 3) current[column] = (raw + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) current[column] = (raw + paeth(left, above, upperLeft)) & 0xff;
      else throw new Error(`Unsupported PNG row filter ${filter}.`);
    }
    if (bitDepth === 8) {
      current.copy(indexes, row * width);
    } else {
      for (let column = 0; column < width; column += 1) {
        indexes[row * width + column] =
          column % 2 === 0
            ? current[Math.floor(column / 2)] >>> 4
            : current[Math.floor(column / 2)] & 0x0f;
      }
    }
    sourceOffset += rowBytes;
    previous = current;
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < indexes.length; index += 1) {
    const paletteIndex = indexes[index];
    const sourceIndex = paletteIndex * 3;
    const destination = index * 4;
    pixels[destination] = palette[sourceIndex] ?? 0;
    pixels[destination + 1] = palette[sourceIndex + 1] ?? 0;
    pixels[destination + 2] = palette[sourceIndex + 2] ?? 0;
    pixels[destination + 3] = transparency?.[paletteIndex] ?? 255;
  }

  return { width, height, pixels };
}

function encodeRgbaPng(width, height, pixels) {
  const rowLength = width * 4;
  const raw = Buffer.alloc((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const destination = row * (rowLength + 1);
    raw[destination] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + row * rowLength, rowLength).copy(
      raw,
      destination + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function blendPixel(pixels, offset, color) {
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * inverse);
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * inverse);
  pixels[offset + 2] = Math.round(color[2] * alpha + pixels[offset + 2] * inverse);
  pixels[offset + 3] = 255;
}

function fillRectangle(pixels, width, x, y, rectangleWidth, rectangleHeight, color) {
  for (let row = y; row < y + rectangleHeight; row += 1) {
    for (let column = x; column < x + rectangleWidth; column += 1) {
      const offset = (row * width + column) * 4;
      if (color[3] === 255) {
        pixels.set(color, offset);
      } else {
        blendPixel(pixels, offset, color);
      }
    }
  }
}

function drawScaledImage(destination, destinationWidth, image, x, y, width, height) {
  for (let row = 0; row < height; row += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(((row + 0.5) * image.height) / height),
    );
    for (let column = 0; column < width; column += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(((column + 0.5) * image.width) / width),
      );
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const alpha = image.pixels[sourceOffset + 3] / 255;
      if (alpha <= 0) continue;
      const destinationOffset =
        ((y + row) * destinationWidth + x + column) * 4;
      const inverse = 1 - alpha;
      destination[destinationOffset] = Math.round(
        image.pixels[sourceOffset] * alpha +
          destination[destinationOffset] * inverse,
      );
      destination[destinationOffset + 1] = Math.round(
        image.pixels[sourceOffset + 1] * alpha +
          destination[destinationOffset + 1] * inverse,
      );
      destination[destinationOffset + 2] = Math.round(
        image.pixels[sourceOffset + 2] * alpha +
          destination[destinationOffset + 2] * inverse,
      );
      destination[destinationOffset + 3] = 255;
    }
  }
}

function boardCoordinates(square, orientation) {
  if (!/^[a-h][1-8]$/.test(square)) {
    throw new Error(`Invalid chess square: ${square}`);
  }
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === "black"
    ? { x: 7 - file, y: rank }
    : { x: file, y: 7 - rank };
}

function piecesFromFen(fen) {
  const placement = String(fen).trim().split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 8) throw new Error("The stored position has an invalid FEN.");
  const pieces = [];

  for (let row = 0; row < ranks.length; row += 1) {
    let file = 0;
    for (const token of ranks[row]) {
      if (/^[1-8]$/.test(token)) {
        file += Number(token);
      } else if (/^[prnbqkPRNBQK]$/.test(token)) {
        if (file >= 8) throw new Error("The stored position has an invalid FEN.");
        pieces.push({
          square: `${String.fromCharCode(97 + file)}${8 - row}`,
          fileName: `${token === token.toUpperCase() ? "w" : "b"}${token.toLowerCase()}.png`,
        });
        file += 1;
      } else {
        throw new Error("The stored position has an invalid FEN.");
      }
    }
    if (file !== 8) throw new Error("The stored position has an invalid FEN.");
  }

  return pieces;
}

async function loadPiece(pieceDirectory, fileName) {
  const source = path.join(pieceDirectory, fileName);
  if (!pieceCache.has(source)) {
    pieceCache.set(
      source,
      readFile(source).then((buffer) => decodeIndexedPng(buffer)),
    );
  }
  return pieceCache.get(source);
}

export async function renderBoardPng({
  fen,
  lastMove = null,
  orientation = "white",
  pieceDirectory,
}) {
  if (!pieceDirectory) {
    throw new Error("ChessCave did not configure its piece artwork directory.");
  }
  if (!["white", "black"].includes(orientation)) {
    throw new Error("Board orientation must be white or black.");
  }

  const pixels = new Uint8Array(BOARD_SIZE * BOARD_SIZE * 4);
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const canonicalFile = orientation === "black" ? 7 - file : file;
      const canonicalRank = orientation === "black" ? rank : 7 - rank;
      const light = (canonicalFile + canonicalRank) % 2 === 1;
      fillRectangle(
        pixels,
        BOARD_SIZE,
        file * SQUARE_SIZE,
        rank * SQUARE_SIZE,
        SQUARE_SIZE,
        SQUARE_SIZE,
        light ? LIGHT_SQUARE : DARK_SQUARE,
      );
    }
  }

  for (const square of [lastMove?.from, lastMove?.to].filter(Boolean)) {
    const coordinates = boardCoordinates(square, orientation);
    fillRectangle(
      pixels,
      BOARD_SIZE,
      coordinates.x * SQUARE_SIZE,
      coordinates.y * SQUARE_SIZE,
      SQUARE_SIZE,
      SQUARE_SIZE,
      LAST_MOVE,
    );
  }

  const pieces = piecesFromFen(fen);
  await Promise.all(
    pieces.map(async (piece) => {
      const artwork = await loadPiece(pieceDirectory, piece.fileName);
      const coordinates = boardCoordinates(piece.square, orientation);
      drawScaledImage(
        pixels,
        BOARD_SIZE,
        artwork,
        coordinates.x * SQUARE_SIZE,
        coordinates.y * SQUARE_SIZE,
        SQUARE_SIZE,
        SQUARE_SIZE,
      );
    }),
  );

  return encodeRgbaPng(BOARD_SIZE, BOARD_SIZE, pixels);
}

export function parseClockTimestamp(value) {
  if (typeof value !== "string") {
    throw new Error("clock must be written as M:SS or H:MM:SS.");
  }
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("clock must be written as M:SS or H:MM:SS.");
  }
  const numbers = parts.map(Number);
  if (
    numbers.some((part) => !Number.isFinite(part) || part < 0) ||
    numbers.at(-1) >= 60 ||
    (numbers.length === 3 && numbers[1] >= 60)
  ) {
    throw new Error("clock must be written as M:SS or H:MM:SS.");
  }
  return numbers.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
}

export function formatClockTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function clockCandidates(positions, sides) {
  const changed = [];
  const all = [];
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    for (const side of sides) {
      const seconds = Number(position.clocks?.[side]);
      if (!Number.isFinite(seconds)) continue;
      const entry = { position, side, seconds };
      all.push(entry);
      const previous = positions[index - 1];
      if (
        index === 0 ||
        !Number.isFinite(Number(previous?.clocks?.[side])) ||
        Number(previous.clocks[side]) !== seconds
      ) {
        changed.push(entry);
      }
    }
  }
  return changed.length ? changed : all;
}

export function selectReviewedPosition(review, options = {}) {
  if (!Array.isArray(review?.positions) || review.positions.length === 0) {
    throw new Error("The stored game review has no positions.");
  }
  const hasPly = options.ply !== undefined && options.ply !== null;
  const hasClock =
    typeof options.clock === "string" && options.clock.trim().length > 0;
  if (hasPly === hasClock) {
    throw new Error("Choose exactly one board selector: ply or clock.");
  }

  if (hasPly) {
    const ply = Number(options.ply);
    if (!Number.isInteger(ply) || ply < 0) {
      throw new Error("ply must be a non-negative integer.");
    }
    const position = review.positions.find((candidate) => candidate.ply === ply);
    if (!position) {
      throw new Error(
        `Ply ${ply} is outside this review (0–${review.positions.at(-1)?.ply ?? 0}).`,
      );
    }
    return { position, matchedClock: null };
  }

  const requestedSeconds = parseClockTimestamp(options.clock);
  const clockSide = options.clock_side ?? "either";
  if (!["white", "black", "either"].includes(clockSide)) {
    throw new Error("clock_side must be white, black, or either.");
  }
  const sides =
    clockSide === "either" ? ["w", "b"] : [clockSide === "white" ? "w" : "b"];
  const candidates = clockCandidates(review.positions, sides)
    .map((entry) => ({
      ...entry,
      differenceSeconds: Math.abs(entry.seconds - requestedSeconds),
    }))
    .sort(
      (left, right) =>
        left.differenceSeconds - right.differenceSeconds ||
        right.position.ply - left.position.ply,
    );
  const match = candidates[0];
  if (!match) {
    throw new Error(
      `This review has no ${clockSide === "either" ? "" : `${clockSide} `}clock timestamps.`,
    );
  }
  return {
    position: match.position,
    matchedClock: {
      requested: options.clock,
      requestedSeconds,
      side: match.side === "w" ? "white" : "black",
      displayed: formatClockTimestamp(match.seconds),
      seconds: match.seconds,
      differenceSeconds: match.differenceSeconds,
    },
  };
}

export async function createPositionImage(review, options, pieceDirectory) {
  const orientation = options.orientation ?? "white";
  const { position, matchedClock } = selectReviewedPosition(review, options);
  const move = position.ply > 0 ? review.moves[position.ply - 1] : null;
  const png = await renderBoardPng({
    fen: position.fen,
    lastMove: position.lastMove,
    orientation,
    pieceDirectory,
  });
  const sideToMove = position.fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
  const metadata = {
    gameKey: review.gameKey,
    ply: position.ply,
    moveNumber: position.ply === 0 ? 0 : Math.ceil(position.ply / 2),
    positionLabel:
      position.ply === 0
        ? "Starting position"
        : `${Math.ceil(position.ply / 2)}${position.ply % 2 === 0 ? "…" : "."} ${move?.san ?? ""}`.trim(),
    fen: position.fen,
    sideToMove,
    lastMove: position.lastMove ?? null,
    clocks: {
      white: {
        displayed: formatClockTimestamp(position.clocks?.w),
        seconds: position.clocks?.w ?? null,
      },
      black: {
        displayed: formatClockTimestamp(position.clocks?.b),
        seconds: position.clocks?.b ?? null,
      },
    },
    matchedClock,
    orientation,
    image: {
      mimeType: "image/png",
      width: BOARD_SIZE,
      height: BOARD_SIZE,
      lastMoveHighlighted: Boolean(position.lastMove),
    },
  };
  return { metadata, png };
}
