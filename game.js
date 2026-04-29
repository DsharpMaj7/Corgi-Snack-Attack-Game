/**
 * Corgi Snack Attack — tiny MVP
 * Tile grid maze, smooth pixel movement, axis-separated wall collision.
 */

// --- Tunables ---
const TILE = 40; // 32 * 1.25 — maze + art scale; logic stays tile-based
/** Lower = easier late turns + more time per tile for lane-assist (was ~7.5 tiles/s at 298). */
const PLAYER_SPEED = 220;
const LANE_ASSIST_SPEED = 455; // pull into corridor center fast when a perpendicular turn is queued
const LANE_ASSIST_BOOST = 2.25; // perpendicular buffered turn: prioritize lining up for the opening
const LANE_ASSIST_URGENT = 1.65; // misaligned + legal neighbor: stronger pull so you don’t overshoot
/** Alignment tolerance after lane / predictive snap (corridor-centered play, not pixel-perfect). */
const TURN_DEADZONE = TILE * 0.98;
/**
 * If a 90° turn is walk-legal and the player is within this lane-axis distance of `colMid`/`rowMid`,
 * snap fully onto lane center before commit (handles tile-edge straddle + late presses).
 */
const TURN_PREDICTIVE_SNAP_MAX = TILE * 1.1;
/** `requestedDirection` cannot expire until this many ms after the last arrow keydown. */
const REQUESTED_DIRECTION_MIN_MS = 420;
/** Latest time `requestedDirection` may persist without being executed (ms after last keydown). */
const REQUESTED_DIRECTION_MAX_MS = 6000;
/** Max movement integrated per physics substep (px) — smaller = more turn attempts per distance traveled. */
const PLAYER_PHYS_MAX_PX = TILE * 0.14;
/**
 * Set `true` to draw turn/buffer debug HUD (and log reject reasons). Must stay `false` for release builds.
 */
const DEBUG_PLAYER_TURNS = false; // set true locally to diagnose rejects / alignment
/** How far toward lane center we pull on turn commit (1 = full snap). */
const TURN_SNAP_BLEND = 0.92;
const SNAP_EPS = 0.65;
const SNAP_EPS_BUFFER = 2.05;
/** Max sim step per rAF frame—slightly higher = less “stutter time lost” on tab hitches; still < half a tile. */
const DT_CAP = 1 / 15;
const PICKUP_RADIUS = TILE * 0.42; // generous vs tile center; still inside corridor
const PICKUP_POP_DECAY = 5.5; // visual punch after a snack (per second)
const PICKUP_PARTICLE_LIFE = 0.22;
const STREAK_CELEBRATION = {
  snacksPerParty: 10,
  durationMs: 3800,
  introBurst: 10,
  sparklesPerSec: 8,
  maxSparkles: 18,
  sparkleLife: [0.8, 1.45],
};

/** Lives / respawn — enemies should call `loseLife()` when they catch the corgi. */
const MAX_LIVES = 3;
const RESPAWN_FREEZE_MIN_MS = 3000;
const RESPAWN_FREEZE_MAX_MS = 5000;
const START_COL = 1;
const START_ROW = 1;

const CAT_SPEED = 148;
const CAT_W = TILE * 0.6;
const CAT_H = TILE * 0.6;
/** Draw-only: fits kawaii cat PNGs into the same hitbox footprint as the old vector cat. */
const CAT_SPRITE_BOX_SCALE = 1.7;
const CAT_SPRITE_Y_OFFSET = TILE * 0.02;
const LEVEL_TRANSITION_MS = 1900;

/** Cat pathing — tweak weights to change “personality” without touching movement code. */
const CAT_AI = {
  BONUS_FORWARD: 0.7,
  BONUS_CHASE: 0.22,
  BONUS_TARGET_PROGRESS: 2.1,
  BONUS_REGION_DISTANCE: 2.8,
  BONUS_SIDE_SWAP: 2.1,
  BONUS_BRANCH_FRESHNESS: 0.34,
  BONUS_BRANCH_REGION: 1.2,
  BONUS_TARGET_REGION: 1.35,
  SAME_REGION_PENALTY: 4.5,
  RECENT_REGION_PENALTY: 8.5,
  PENALTY_REVERSE: 5.5,
  PENALTY_RECENT_TRAIL: 5.4,
  PENALTY_LOCAL_LOOP: 6.5,
  /** Extra dislike for stepping onto a tile that appears again in the recent trail (stops A↔B shuttling). */
  PENALTY_RECENT_STEP_TILE: 5.1,
  /** After a stuck detection, temporarily weight roam progress / anti-trail stronger so the next picks escape the pocket. */
  ESCAPE_MS: 3800,
  ESCAPE_ROAM_PROGRESS_MULT: 1.95,
  ESCAPE_TRAIL_MULT: 1.55,
  /** Min distance (px) traveled along current heading after any turn before we may choose again at a junction/corner. */
  MIN_COMMIT_TRAVEL_PX: TILE * 1.08,
  /**
   * Extra cooldown after a branch pick — stacks with commitment distance so cats don’t spin on tile centers.
   */
  COOLDOWN_MS: [260, 420],
  TARGET_CHOICE_RANGE: [12, 22],
  TARGET_REACHED_DIST: 1,
  CHASE_RANGE_TILES: 5,
  EDGE_MARGIN: 2,
  MIN_TARGET_DIST: 10,
  REGION_COLS: 3,
  REGION_ROWS: 3,
  RECENT_TARGET_REGION_COUNT: 4,
  RECENT_TRAIL_LIMIT: 28,
  /** If the last N trail tiles use ≤ this many distinct cells, treat as a tight loop (covers 4‑tile loops). */
  STUCK_TRAIL_WINDOW: 14,
  STUCK_UNIQUE_TILES_MAX: 5,
  /** Same tile id appears ≥ this many times in the last STUCK_REVISIT_WINDOW trail slots → local hover. */
  STUCK_REVISIT_MIN: 5,
  STUCK_REVISIT_WINDOW: 20,
  LOOKAHEAD_STEPS: 12,
  EXPLORE_DEPTH: 6,
  VISIT_AGE_CAP: 30,
  DECISION_JITTER: 0.055,
  EARLY_EXPLORE_MS: 6500,
  EARLY_MIN_TARGET_DIST_BOOST: 4,
  EARLY_TARGET_PROGRESS_BOOST: 1.2,
  EARLY_BRANCH_FRESHNESS_BOOST: 0.16,
  EARLY_BRANCH_REGION_BOOST: 0.95,
  EARLY_SIDE_SWAP_MULT: 0.75,
  EARLY_TRAIL_PENALTY_BOOST: 1.7,
  EARLY_LOOP_PENALTY_BOOST: 2.1,
  EARLY_FORWARD_FADE: 0.65,
  EARLY_CHASE_FADE: 0.8,
  SPAWN_MEMORY_DEPTH: 2,
};

// Cell codes
const EMPTY = 0;
const WALL = 1;
const SNACK = 2;

// Maze: # wall, . snack, space empty (no snack).
// All levels share the same board size so the canvas and drawing code stay simple.
const LEVELS = [
  {
    title: "Level 1",
    catSpeed: 132,
    catSpawns: [{ c: 3, r: 8 }],
    maze: [
      "#####################",
      "#...................#",
      "#...#...........#...#",
      "#.#.#.##.....##.#.#.#",
      "#.#.#...#...#...#.#.#",
      "#.#.....#...#.....#.#",
      "#.#.###.#...#.###.#.#",
      "#.#...............#.#",
      "#.....#####.#####...#",
      "#.###...........###.#",
      "#...#.###...###.#...#",
      "#.#.#...#...#...#.#.#",
      "#.#.#...#...#...#.#.#",
      "#.#...............#.#",
      "#...#.....#.....#...#",
      "#...................#",
      "#####################",
    ],
  },
  {
    title: "Level 2",
    catSpeed: 148,
    catSpawns: [{ c: 4, r: 8 }],
    maze: [
      "#####################",
      "#...................#",
      "#...#.....#.....#...#",
      "#.#.#.###.#.###.#.#.#",
      "#.#.#...#.#...#.#.#.#",
      "#.#.###.#.#.#.###.#.#",
      "#.#.....#.#.#.....#.#",
      "#.#.###...#...###.#.#",
      "#.#...#####.#...#.#.#",
      "#.##......#.....###.#",
      "#...#.###.#.###.#...#",
      "#.#.#...#.#.#...#.#.#",
      "#.#.###.#.#.#.###.#.#",
      "#.#.....#.#.#.....#.#",
      "#...#.....#.....#...#",
      "#...................#",
      "#####################",
    ],
  },
  {
    title: "Level 3",
    catSpeed: 168,
    catSpawns: [{ c: 11, r: 7 }],
    maze: [
      "#####################",
      "#...................#",
      "#.###.#.....#.###.#.#",
      "#.#...#.###.#...#.#.#",
      "#.#.#.#...#.#.#.#.#.#",
      "#...#...#.#...#...#.#",
      "###.###.#.#.###.###.#",
      "#.....#...#...#.....#",
      "#.#####.#####.#####.#",
      "#.....#...#...#.....#",
      "###.###.#.#.###.###.#",
      "#...#...#.#...#...#.#",
      "#.#.#.#...#...#.#.#.#",
      "#.#...#.###.#...#.#.#",
      "#.###.#.....#.###.#.#",
      "#...................#",
      "#####################",
    ],
  },
  {
    title: "Level 4",
    catSpeed: 152,
    catSpawns: [
      { c: 5, r: 11 },
      { c: 15, r: 11 },
    ],
    maze: [
      "#####################",
      "#...................#",
      "#.###...#.#.#...###.#",
      "#...#.#.#.#.#.#.#...#",
      "###.#.#...#...#.#.###",
      "#...#...#...#...#...#",
      "#.#####.#.#.#.#####.#",
      "#.....#.#...#.#.....#",
      "#.###.#.#####.#.###.#",
      "#...#.#...#...#.#...#",
      "###.#.###.#.###.#.###",
      "#...#.....#.....#...#",
      "#.###.###.#.###.###.#",
      "#...#...#...#...#...#",
      "#.#.###.#####.###.#.#",
      "#...................#",
      "#####################",
    ],
  },
  {
    title: "Level 5",
    catSpeed: 160,
    catSpawns: [
      { c: 7, r: 15 },
      { c: 17, r: 10 },
    ],
    maze: [
      "#####################",
      "#...................#",
      "#.###.#.#...#.#.###.#",
      "#...#.#.###.#.#.#...#",
      "###.#...#.#.#...#.###",
      "#...###.#.#.#.###...#",
      "#.#.....#...#.....#.#",
      "#.#.###.#####.###.#.#",
      "#...#...#...#...#...#",
      "###.#.###.#.###.#.###",
      "#...#.....#.....#...#",
      "#.#.#####.#.#####.#.#",
      "#.#...#...#...#...#.#",
      "#.###.#.#####.#.###.#",
      "#...#...#...#...#...#",
      "#...................#",
      "#####################",
    ],
  },
];
const TOTAL_LEVELS = LEVELS.length;

/** Snack collectible image pool. Selection logic stays the same; only the art source changes. */
const SNACK_SET = [
  { id: "pizza", src: "assets/images/pizza.png", rim: "#e36f59", glow: "rgba(227, 111, 89, 0.48)", displayScale: 1.25 },
  { id: "corndog", src: "assets/images/corndog.png", rim: "#d88f43", glow: "rgba(216, 143, 67, 0.48)", displayScale: 1.25 },
  { id: "ramen", src: "assets/images/ramen.png", rim: "#e79c54", glow: "rgba(231, 156, 84, 0.48)", displayScale: 1.4 },
  { id: "cupcake", src: "assets/images/cupcake.png", rim: "#e86aa7", glow: "rgba(232, 106, 167, 0.44)", displayScale: 1.52 },
  { id: "cookie", src: "assets/images/cookie.png", rim: "#b27a4a", glow: "rgba(178, 122, 74, 0.4)", displayScale: 1.25 },
  { id: "mochidonut", src: "assets/images/mochidonut.png", rim: "#ea77b9", glow: "rgba(234, 119, 185, 0.46)" },
  { id: "boba", src: "assets/images/boba.png", rim: "#67bde7", glow: "rgba(103, 189, 231, 0.46)", displayScale: 1.25 },
  { id: "cinnamonroll", src: "assets/images/cinnamonroll.png", rim: "#cf8d57", glow: "rgba(207, 141, 87, 0.44)", displayScale: 1.2 },
];
const SNACK_BY_ID = Object.fromEntries(SNACK_SET.map((snack) => [snack.id, snack]));
const snackSpriteCache = new Map();
const SNACK_IMAGE_FIT = 0.84;
const snackImageStatus = Object.fromEntries(SNACK_SET.map((snack) => [snack.id, "loading"]));
const snackImageBounds = Object.fromEntries(SNACK_SET.map((snack) => [snack.id, null]));

function measureOpaqueImageBounds(image) {
  const width = image.naturalWidth || 0;
  const height = image.naturalHeight || 0;
  if (!width || !height) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }

  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const g = probe.getContext("2d", { willReadFrequently: true });
  g.drawImage(image, 0, 0);
  const { data } = g.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const alphaThreshold = 12;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = data[rowOffset + x * 4 + 3];
      if (alpha <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { sx: 0, sy: 0, sw: width, sh: height };
  }

  // Keep a small buffer so anti-aliased edges and soft outlines do not get clipped.
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  return {
    sx: minX,
    sy: minY,
    sw: Math.max(1, maxX - minX + 1),
    sh: Math.max(1, maxY - minY + 1),
  };
}

function loadSnackImageAsset(snack) {
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    snackImageBounds[snack.id] = measureOpaqueImageBounds(image);
    snackImageStatus[snack.id] = "ready";
  });
  image.addEventListener("error", () => {
    snackImageStatus[snack.id] = "error";
    console.error(`[snack-image] Failed to load ${snack.src}`);
  });
  image.src = snack.src;
  return image;
}

const snackImages = Object.fromEntries(SNACK_SET.map((snack) => [snack.id, loadSnackImageAsset(snack)]));

// --- DOM ---
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const bodyEl = document.body;
const elSnack = document.getElementById("snack-count");
const elLevel = document.getElementById("level-display");
const elLives = document.getElementById("lives-display");
const elStatus = document.getElementById("status");
const elAudioBtn = document.getElementById("btn-audio");
const elSkyDecorations = document.getElementById("sky-decorations");
const elStreakBanner = document.getElementById("streak-banner");
const elStreakBannerTitle = document.getElementById("streak-banner-title");

const SKY_DECORATIONS = Object.freeze([
  {
    id: "upper-left",
    position: "upper-left",
    src: "assets/images/corgi.head.cloud.png?v=20260425-2",
    mount: {
      top: "clamp(56px, 10vh, 96px)",
      left: "clamp(78px, 8vw, 128px)",
      width: "260px",
      drift: "sky-cloud-drift",
      duration: "104s",
      delay: "-8s",
      opacity: "0.88",
    },
  },
  {
    id: "lower-left",
    position: "lower-left",
    src: "assets/images/corgi.sleep.cloud.png?v=20260425-2",
    mount: {
      bottom: "clamp(42px, 8vh, 88px)",
      left: "clamp(76px, 8vw, 126px)",
      width: "264px",
      drift: "sky-cloud-drift-alt",
      duration: "116s",
      delay: "-20s",
      opacity: "0.88",
    },
  },
  {
    id: "upper-right",
    position: "upper-right",
    src: "assets/images/corgi.side.cloud.png?v=20260425-2",
    mount: {
      top: "clamp(60px, 10vh, 100px)",
      right: "clamp(78px, 8vw, 128px)",
      width: "260px",
      drift: "sky-cloud-drift-alt",
      duration: "110s",
      delay: "-14s",
      opacity: "0.88",
    },
  },
  {
    id: "lower-right",
    position: "lower-right",
    src: "assets/images/corgi.butt.cloud.png?v=20260425-2",
    mount: {
      bottom: "clamp(42px, 8vh, 88px)",
      right: "clamp(76px, 8vw, 126px)",
      width: "252px",
      drift: "sky-cloud-drift",
      duration: "118s",
      delay: "-18s",
      opacity: "0.88",
    },
  },
]);

function applySkyStyleVars(node, styles) {
  for (const [property, value] of Object.entries(styles)) {
    node.style.setProperty(property, value);
  }
}

function createSkyDecorationElement(decoration) {
  const mount = document.createElement("div");
  mount.className = "sky-image-mount";
  mount.dataset.skyId = decoration.id;
  mount.dataset.skyPosition = decoration.position;
  applySkyStyleVars(mount, {
    "--mount-top": decoration.mount.top || "auto",
    "--mount-right": decoration.mount.right || "auto",
    "--mount-bottom": decoration.mount.bottom || "auto",
    "--mount-left": decoration.mount.left || "auto",
    "--mount-width": decoration.mount.width,
    "--mount-animation-name": decoration.mount.drift,
    "--mount-animation-duration": decoration.mount.duration,
    "--mount-animation-delay": decoration.mount.delay,
    "--mount-opacity": decoration.mount.opacity || "0.88",
  });

  const image = document.createElement("img");
  image.className = "sky-decoration-image";
  image.src = decoration.src;
  image.alt = "";
  image.decoding = "async";
  image.loading = "eager";
  mount.append(image);
  return mount;
}

function renderSkyDecorations() {
  if (!elSkyDecorations) return;
  elSkyDecorations.replaceChildren(...SKY_DECORATIONS.map(createSkyDecorationElement));
}

renderSkyDecorations();

function fillCircleShape(g, x, y, r, fillStyle) {
  g.fillStyle = fillStyle;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function fillEllipseShape(g, x, y, rx, ry, fillStyle, rotation = 0) {
  g.fillStyle = fillStyle;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  g.fill();
}

function fillRoundRectShape(g, x, y, w, h, r, fillStyle) {
  g.fillStyle = fillStyle;
  roundRectPath(g, x, y, w, h, r);
  g.fill();
}

function strokeRoundRectShape(g, x, y, w, h, r, strokeStyle, lineWidth) {
  g.strokeStyle = strokeStyle;
  g.lineWidth = lineWidth;
  roundRectPath(g, x, y, w, h, r);
  g.stroke();
}

function strokeLineShape(g, x1, y1, x2, y2, strokeStyle, lineWidth) {
  g.strokeStyle = strokeStyle;
  g.lineWidth = lineWidth;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function snapSnackSpriteSize(size) {
  return Math.max(14, Math.round(size / 2) * 2);
}

function drawSnackIconArt(g, snackId, size) {
  const unit = (size / 32) * 1.15;
  g.save();
  g.translate(size / 2, size / 2);
  g.scale(unit, unit);
  g.translate(-16, -16);
  g.lineCap = "round";
  g.lineJoin = "round";
  fillEllipseShape(g, 16, 27, 8.5, 3, "rgba(103, 86, 126, 0.14)");

  if (snackId === "hot-dog") {
    g.save();
    g.translate(16.3, 15.2);
    g.scale(1.18, 1.18);
    g.rotate(-0.92);

    g.fillStyle = "#f2d3a1";
    g.beginPath();
    g.moveTo(-11.7, 2.1);
    g.lineTo(-22.9, 14.1);
    g.lineTo(-20.7, 15.8);
    g.lineTo(-9.8, 3.8);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(151, 108, 68, 0.38)";
    g.lineWidth = 0.88;
    g.stroke();
    strokeLineShape(g, -20.5, 13.9, -10.8, 3.5, "rgba(255, 247, 227, 0.42)", 0.62);

    fillRoundRectShape(g, -10.2, -5, 20.4, 10, 5, "#d99535");
    strokeRoundRectShape(g, -10.2, -5, 20.4, 10, 5, "rgba(138, 92, 42, 0.42)", 1);
    fillRoundRectShape(g, -8.9, -3.9, 17.8, 7.8, 3.9, "#e4a84b");

    for (const [sx, sy, r, color] of [
      [-6.9, -2.6, 0.46, "#c28134"],
      [-4.6, 0.7, 0.42, "#b9782e"],
      [-2.8, -0.9, 0.35, "#bb7d31"],
      [0.2, 2.1, 0.42, "#bc7f35"],
      [2.4, -1.8, 0.44, "#c78639"],
      [4.7, 0.6, 0.38, "#b8742e"],
      [6.5, -1, 0.34, "#c4873a"],
      [7.7, 1.8, 0.32, "#b9772d"],
      [-1.6, -2.8, 0.28, "#cf9041"],
    ]) {
      fillCircleShape(g, sx, sy, r, color);
    }

    g.strokeStyle = "#ffe2a2";
    g.lineWidth = 2.55;
    g.beginPath();
    g.moveTo(-8.8, -1.6);
    g.bezierCurveTo(-6.6, -4.4, -4.8, 1.1, -2.4, -1.2);
    g.bezierCurveTo(-0.1, -3.5, 2.2, 1.6, 4.5, -1);
    g.bezierCurveTo(6.6, -3.4, 8.5, 0.8, 9.5, -1);
    g.stroke();

    g.strokeStyle = "#e84a4e";
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-9.2, 0.7);
    g.bezierCurveTo(-7.1, -1.8, -5.1, 3.1, -2.8, 0.8);
    g.bezierCurveTo(-0.5, -1.5, 1.8, 2.9, 4, 0.7);
    g.bezierCurveTo(6, -1.3, 8.2, 2, 9.5, 0.4);
    g.stroke();

    fillEllipseShape(g, 1.9, -1.9, 5.8, 1.8, "rgba(255, 236, 175, 0.24)");
    fillCircleShape(g, -2.6, -2.4, 0.8, "rgba(255,255,255,0.38)");
    g.restore();
  } else if (snackId === "hamburger") {
    fillEllipseShape(g, 16, 12.6, 10.2, 5.2, "#efb360");
    for (const [sx, sy, rot] of [
      [11.2, 11.2, -0.3],
      [13.9, 10.3, 0.18],
      [16.7, 11, -0.12],
      [19.5, 10.5, 0.28],
      [21.5, 11.5, -0.24],
      [15.2, 12, 0.2],
    ]) {
      fillEllipseShape(g, sx, sy, 0.9, 0.46, "#fff7da", rot);
    }
    fillRoundRectShape(g, 8.5, 15.45, 15, 1.6, 0.82, "#ff857c");
    g.fillStyle = "#72cb7e";
    g.beginPath();
    g.moveTo(7.8, 17.2);
    g.quadraticCurveTo(9.9, 15.4, 12, 17.2);
    g.quadraticCurveTo(14.2, 15.6, 16.3, 17.2);
    g.quadraticCurveTo(18.5, 15.6, 20.6, 17.2);
    g.quadraticCurveTo(22.9, 15.7, 24.3, 17.9);
    g.lineTo(24, 18.6);
    g.lineTo(7.8, 18.6);
    g.closePath();
    g.fill();
    fillRoundRectShape(g, 7.2, 17.95, 17.6, 6.75, 2.55, "#5c372a");
    fillRoundRectShape(g, 8.1, 19.05, 15.9, 1.95, 0.95, "#754838");
    g.fillStyle = "#ffd45a";
    g.beginPath();
    g.moveTo(15.3, 18.25);
    g.lineTo(22.4, 18.25);
    g.lineTo(19, 22.35);
    g.lineTo(14.3, 22.35);
    g.closePath();
    g.fill();
    fillEllipseShape(g, 16, 24.45, 9.05, 4.3, "#dc9854");
  } else if (snackId === "ramen") {
    strokeLineShape(g, 9.4, 8.3, 24.7, 10.8, "#9f6a45", 1.85);
    strokeLineShape(g, 8.5, 6.5, 23.8, 9, "#c99562", 1.7);
    g.fillStyle = "#d96a55";
    g.beginPath();
    g.moveTo(7, 18.1);
    g.quadraticCurveTo(8.2, 27.8, 16, 28.2);
    g.quadraticCurveTo(23.8, 27.8, 25, 18.1);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(106, 60, 64, 0.48)";
    g.lineWidth = 1.15;
    g.stroke();
    fillEllipseShape(g, 16, 17.6, 9, 4.2, "#ffd981");
    g.strokeStyle = "#e2ab36";
    g.lineWidth = 1.55;
    for (const y of [16.2, 17.5, 18.8]) {
      g.beginPath();
      g.moveTo(9, y);
      g.bezierCurveTo(11.8, y - 1.15, 14, y + 1.35, 16.1, y);
      g.bezierCurveTo(18.4, y - 1.15, 20.7, y + 1.15, 23, y - 0.15);
      g.stroke();
    }
    fillCircleShape(g, 10.7, 17.1, 2.35, "#fff8f1");
    fillCircleShape(g, 10.7, 17.1, 0.95, "#f0bb3c");
    fillCircleShape(g, 20.8, 16.8, 1.85, "#ff88a1");
    fillCircleShape(g, 20.8, 16.8, 0.58, "#fff");
    fillEllipseShape(g, 16.8, 15.7, 1.25, 2.55, "#5bc97e", 0.32);
  } else if (snackId === "lollipop") {
    const donutPuffs = [];
    const sprinkleStrokes = [
      [13.4, 7.4, 0.34, "#ffd55b"],
      [17.1, 7.7, -0.18, "#69c4ff"],
      [20.6, 9.5, 0.84, "#7ec35b"],
      [23.1, 12.6, -0.42, "#ff9f58"],
      [23.3, 18, 0.22, "#ffdf6b"],
      [20.8, 22.1, 0.92, "#76c75a"],
      [17.2, 24.2, -0.26, "#ffd966"],
      [13.3, 24.2, 0.38, "#69c4ff"],
      [9.6, 21.8, -0.84, "#ff9f58"],
      [7.8, 17.4, 0.12, "#ffd966"],
      [8.5, 12.6, -0.36, "#7ec35b"],
      [10.4, 9.3, 0.72, "#69c4ff"],
    ];
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 8;
      donutPuffs.push([16 + Math.cos(angle) * 6.6, 16 + Math.sin(angle) * 6.6]);
    }

    fillEllipseShape(g, 16, 24.9, 8, 2.05, "rgba(176, 110, 120, 0.14)");
    for (const [cx, cy] of donutPuffs) {
      fillCircleShape(g, cx, cy, 4.35, "#c98557");
    }
    for (const [cx, cy] of donutPuffs) {
      fillCircleShape(g, cx, cy - 0.35, 3.55, "#ff8fc7");
    }
    g.save();
    g.globalCompositeOperation = "destination-out";
    fillCircleShape(g, 16, 16.1, 5.05, "#000");
    g.restore();

    g.strokeStyle = "rgba(157, 81, 121, 0.28)";
    g.lineWidth = 0.82;
    for (const [cx, cy] of donutPuffs) {
      g.beginPath();
      g.arc(cx, cy - 0.35, 3.55, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = "rgba(160, 116, 72, 0.32)";
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(16, 16.1, 5.15, 0, Math.PI * 2);
    g.stroke();

    for (const [x, y, angle, color] of sprinkleStrokes) {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      strokeLineShape(g, -0.75, 0, 0.75, 0, color, 1.02);
      g.restore();
    }
    fillCircleShape(g, 12.3, 10.2, 1.3, "rgba(255,255,255,0.54)");
    fillCircleShape(g, 19.8, 12.2, 0.95, "rgba(255,255,255,0.44)");
  } else if (snackId === "sundae") {
    fillEllipseShape(g, 16, 26.1, 5.3, 1.45, "rgba(186, 203, 238, 0.55)");
    g.fillStyle = "#c5ebff";
    g.beginPath();
    g.moveTo(10.2, 16.2);
    g.lineTo(21.8, 16.2);
    g.lineTo(18.9, 24.3);
    g.lineTo(13.1, 24.3);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(88, 137, 174, 0.48)";
    g.lineWidth = 1.1;
    g.stroke();
    fillRoundRectShape(g, 15.15, 24.1, 1.7, 2.5, 0.85, "#f8fcff");
    fillCircleShape(g, 12.1, 15.1, 4.55, "#9cd9ff");
    fillCircleShape(g, 19.9, 15.3, 4.4, "#ffb6cf");
    fillCircleShape(g, 16.2, 11.9, 5.5, "#fff1d0");
    g.strokeStyle = "#ff7090";
    g.lineWidth = 1.7;
    g.beginPath();
    g.moveTo(11.7, 16.2);
    g.quadraticCurveTo(14.2, 14, 16.3, 16.2);
    g.quadraticCurveTo(18.6, 18.2, 20.8, 15.9);
    g.stroke();
    fillCircleShape(g, 16.4, 7.9, 1.95, "#ff4d6c");
    strokeLineShape(g, 16.7, 6.4, 18, 4.6, "#5fbf79", 1.18);
    fillCircleShape(g, 13.6, 10.7, 0.95, "rgba(255,255,255,0.46)");
  } else if (snackId === "cupcake") {
    g.save();
    g.translate(16.2, 16.4);
    g.scale(1.15, 1.15);
    g.translate(-16.2, -16.4);
    fillEllipseShape(g, 16.2, 26.1, 8.7, 2.05, "rgba(189, 138, 121, 0.18)");

    g.fillStyle = "#f4a4bf";
    g.beginPath();
    g.moveTo(8.3, 13.3);
    g.lineTo(20.6, 13.3);
    g.quadraticCurveTo(23.7, 13.4, 25.2, 15.5);
    g.lineTo(23.7, 25.2);
    g.quadraticCurveTo(17.9, 26.3, 9.6, 25.8);
    g.quadraticCurveTo(7.8, 25.2, 7.9, 23);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(124, 75, 95, 0.36)";
    g.lineWidth = 1;
    g.stroke();

    g.fillStyle = "#f8b9cf";
    g.beginPath();
    g.moveTo(9.1, 13.9);
    g.lineTo(20.7, 13.9);
    g.quadraticCurveTo(23.1, 14, 24.4, 15.5);
    g.lineTo(10.1, 16.7);
    g.quadraticCurveTo(8.8, 15.8, 9.1, 13.9);
    g.closePath();
    g.fill();

    g.fillStyle = "#ffd468";
    g.beginPath();
    g.moveTo(9.2, 16.9);
    g.lineTo(24, 15.9);
    g.lineTo(23.6, 18.3);
    g.lineTo(9.2, 19);
    g.closePath();
    g.fill();

    g.fillStyle = "#fff8ec";
    g.beginPath();
    g.moveTo(9.1, 19.2);
    g.lineTo(23.6, 18.6);
    g.lineTo(23.1, 21.1);
    g.lineTo(9.1, 21.7);
    g.closePath();
    g.fill();

    for (const x of [12.1, 16.1, 19.7]) {
      g.fillStyle = "#ff3c57";
      g.beginPath();
      g.moveTo(x, 20.9);
      g.quadraticCurveTo(x - 1.65, 18.3, x, 17.1);
      g.quadraticCurveTo(x + 1.65, 18.3, x, 20.9);
      g.closePath();
      g.fill();

      g.fillStyle = "#ffd6df";
      g.beginPath();
      g.moveTo(x, 20.2);
      g.quadraticCurveTo(x - 0.72, 18.7, x, 18);
      g.quadraticCurveTo(x + 0.72, 18.7, x, 20.2);
      g.closePath();
      g.fill();
    }

    g.fillStyle = "#ffc74e";
    g.beginPath();
    g.moveTo(9, 21.9);
    g.lineTo(23.1, 21.4);
    g.lineTo(22.2, 24.6);
    g.lineTo(9, 25);
    g.closePath();
    g.fill();

    fillCircleShape(g, 10.4, 12.4, 2.55, "#fff8ef");
    fillCircleShape(g, 8.8, 14.3, 2.15, "#fff3df");
    fillCircleShape(g, 12.6, 14.2, 2.05, "#fff6e7");
    g.strokeStyle = "rgba(187, 159, 113, 0.28)";
    g.lineWidth = 0.86;
    g.beginPath();
    g.moveTo(8.9, 14.1);
    g.quadraticCurveTo(10.1, 11.6, 12.4, 13);
    g.stroke();

    g.fillStyle = "#ff445f";
    g.beginPath();
    g.moveTo(18.1, 8.7);
    g.quadraticCurveTo(21.4, 9.1, 21.3, 12.2);
    g.quadraticCurveTo(20.8, 15.4, 17.9, 15.2);
    g.quadraticCurveTo(15.2, 14.6, 15.1, 11.7);
    g.quadraticCurveTo(15.3, 8.9, 18.1, 8.7);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(134, 53, 68, 0.4)";
    g.lineWidth = 0.9;
    g.stroke();
    fillEllipseShape(g, 16.5, 8.5, 1.15, 1.85, "#169f5d", -0.78);
    fillEllipseShape(g, 18.2, 7.9, 1.2, 2, "#0f8b4e", 0);
    fillEllipseShape(g, 19.8, 8.5, 1.15, 1.85, "#169f5d", 0.76);
    for (const [sx, sy] of [
      [17.1, 10.2],
      [18.5, 10.8],
      [16.9, 12.1],
      [18.6, 12.7],
    ]) {
      fillCircleShape(g, sx, sy, 0.33, "#ffe2b8");
    }
    fillCircleShape(g, 16.8, 10.1, 0.7, "rgba(255,255,255,0.42)");
    g.restore();
  } else if (snackId === "pizza") {
    g.save();
    g.translate(16, 16.8);
    g.scale(1.15, 1.15);
    g.translate(-16, -16.8);
    g.fillStyle = "#ff7d53";
    g.beginPath();
    g.moveTo(16, 27.8);
    g.lineTo(8.1, 10.8);
    g.quadraticCurveTo(16, 7.6, 23.9, 10.8);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(160, 80, 59, 0.28)";
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#ffe182";
    g.beginPath();
    g.moveTo(16, 24.5);
    g.lineTo(9.8, 12.8);
    g.quadraticCurveTo(16, 10.6, 22.2, 12.8);
    g.closePath();
    g.fill();
    g.strokeStyle = "#b97836";
    g.lineWidth = 4.45;
    g.beginPath();
    g.moveTo(9.6, 10.4);
    g.quadraticCurveTo(16, 8.35, 22.4, 10.4);
    g.stroke();
    for (const [px, py] of [
      [12.7, 15.1],
      [19.1, 14.9],
      [16, 19.3],
    ]) {
      fillCircleShape(g, px, py, 2.25, "#e84e5f");
    }
    fillCircleShape(g, 18.7, 12.9, 1, "rgba(255,255,255,0.42)");
    g.restore();
  } else if (snackId === "cookie") {
    g.save();
    g.translate(16, 16);
    g.rotate(-0.1);
    g.scale(1.15, 1.15);
    g.translate(-16, -16);
    fillCircleShape(g, 16, 16, 8.9, "#d7a36c");
    g.strokeStyle = "rgba(142, 94, 55, 0.36)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(16, 16, 8.9, 0, Math.PI * 2);
    g.stroke();
    for (const [cx, cy, r] of [
      [12, 12.4, 1.45],
      [18.8, 12.4, 1.3],
      [14.2, 17.9, 1.45],
      [20.5, 17.6, 1.2],
      [11.1, 19.1, 1.05],
    ]) {
      fillCircleShape(g, cx, cy, r, "#654236");
    }
    fillCircleShape(g, 13.6, 11.2, 0.95, "rgba(255,255,255,0.26)");
    g.restore();
  } else if (snackId === "sushi") {
    g.save();
    g.translate(16, 17.1);
    g.scale(1.24, 1.15);
    g.translate(-16, -17.1);
    fillEllipseShape(g, 16, 24.8, 7.8, 1.9, "rgba(104, 88, 84, 0.12)");
    fillEllipseShape(g, 16, 19.1, 8.6, 5.4, "#f4f2f4");
    for (const [cx, cy] of [
      [11.1, 18.6],
      [13.9, 17.9],
      [17, 17.9],
      [19.9, 18.5],
      [11.9, 20.8],
      [15, 20.6],
      [18.2, 20.6],
      [20.9, 20.7],
    ]) {
      fillCircleShape(g, cx, cy, 1.85, "#ffffff");
    }
    g.strokeStyle = "rgba(177, 168, 174, 0.3)";
    g.lineWidth = 0.85;
    g.beginPath();
    g.ellipse(16, 19.2, 8.2, 5.3, 0, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = "#f1c34f";
    g.beginPath();
    g.moveTo(8.4, 12.8);
    g.lineTo(23.5, 12.6);
    g.quadraticCurveTo(24.9, 12.7, 24.7, 14.1);
    g.lineTo(23.2, 18.1);
    g.quadraticCurveTo(22.8, 19.1, 21.4, 19.1);
    g.lineTo(10.8, 19.2);
    g.quadraticCurveTo(9.2, 19.1, 8.6, 18);
    g.lineTo(7.3, 14.2);
    g.quadraticCurveTo(7.1, 12.9, 8.4, 12.8);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(177, 137, 49, 0.34)";
    g.lineWidth = 0.95;
    g.stroke();
    g.strokeStyle = "rgba(255, 232, 153, 0.56)";
    g.lineWidth = 0.85;
    for (const y of [14.1, 15.5]) {
      g.beginPath();
      g.moveTo(10.1, y);
      g.quadraticCurveTo(16, y - 1, 21.9, y);
      g.stroke();
    }
    fillRoundRectShape(g, 14.45, 12.2, 3.15, 10.9, 1.3, "#2d3b37");
    fillRoundRectShape(g, 15.45, 12.4, 0.82, 10.5, 0.42, "rgba(255,255,255,0.08)");
    fillCircleShape(g, 12.7, 13.8, 0.95, "rgba(255,255,255,0.46)");
    g.restore();
  } else if (snackId === "cinnamon-roll") {
    g.save();
    g.translate(16, 16.2);
    g.scale(1.18, 1.18);
    g.translate(-16, -16.2);
    const drawRollSpiral = () => {
      const turns = 30;
      for (let i = 0; i <= turns; i++) {
        const t = i / turns;
        const angle = 0.9 + t * Math.PI * 4.1;
        const radius = 8 - t * 6.1;
        const x = 16 + Math.cos(angle) * radius;
        const y = 15.8 + Math.sin(angle) * radius * 0.78;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };

    fillEllipseShape(g, 16, 24.9, 7.4, 2.1, "rgba(165, 119, 79, 0.18)");
    fillEllipseShape(g, 16, 16.6, 9.2, 8.5, "#c97845");
    g.strokeStyle = "rgba(136, 85, 48, 0.36)";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(16, 16.6, 9.2, 8.5, 0, 0, Math.PI * 2);
    g.stroke();
    fillEllipseShape(g, 16, 15.9, 7.7, 7, "#e8ac70");

    g.strokeStyle = "#b66d3f";
    g.lineWidth = 2.4;
    g.beginPath();
    drawRollSpiral();
    g.stroke();

    g.strokeStyle = "#fff8f0";
    g.lineWidth = 1.45;
    g.beginPath();
    drawRollSpiral();
    g.stroke();

    fillEllipseShape(g, 12.8, 11.7, 2.4, 1.45, "rgba(255,255,255,0.3)");
    fillEllipseShape(g, 20.1, 19.6, 2.8, 1.4, "rgba(255, 244, 224, 0.22)");
    g.restore();
  } else if (snackId === "corn") {
    fillEllipseShape(g, 16, 24.9, 7.9, 1.95, "rgba(120, 125, 84, 0.14)");
    g.save();
    g.translate(16, 16.3);
    g.rotate(-0.48);
    g.scale(1.15, 1.15);
    g.translate(-16, -16.3);

    fillEllipseShape(g, 16, 16.1, 5.1, 8.7, "#f1cb2f");
    g.strokeStyle = "rgba(171, 137, 40, 0.4)";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(16, 16.1, 5.1, 8.7, 0, 0, Math.PI * 2);
    g.stroke();
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 3; col++) {
        fillCircleShape(g, 13.55 + col * 2.35 + (row % 2) * 0.42, 9.9 + row * 2.35, 0.82, row < 2 ? "#fff0a9" : "#ffd95e");
      }
    }
    fillCircleShape(g, 13.2, 9.7, 0.9, "#fff4b8");
    fillCircleShape(g, 18.1, 12.2, 0.66, "rgba(255,255,255,0.34)");

    g.fillStyle = "#63b45c";
    g.beginPath();
    g.moveTo(12.7, 17.5);
    g.quadraticCurveTo(8.5, 17.9, 7.8, 24.1);
    g.quadraticCurveTo(12.1, 22.4, 15.1, 18.2);
    g.closePath();
    g.fill();

    g.fillStyle = "#5ba553";
    g.beginPath();
    g.moveTo(19.2, 17.3);
    g.quadraticCurveTo(23.9, 18.2, 24.5, 23.3);
    g.quadraticCurveTo(20.5, 22.6, 17, 18.1);
    g.closePath();
    g.fill();
    g.restore();
  }

  g.restore();
}

function getSnackSprite(snackId, size) {
  const drawSize = snapSnackSpriteSize(size);
  const snack = SNACK_BY_ID[snackId] || SNACK_SET[0];
  const sizeBoost = Number.isFinite(snack.displayScale) ? snack.displayScale : 1;
  const prerenderDpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${snack.id}:${drawSize}:s${sizeBoost}:d${prerenderDpr}`;
  if (snackSpriteCache.has(key)) return snackSpriteCache.get(key);

  const image = snackImages[snack.id];
  if (!imageLoaded(image)) return null;
  const bounds = snackImageBounds[snack.id] || {
    sx: 0,
    sy: 0,
    sw: image.naturalWidth || 1,
    sh: image.naturalHeight || 1,
  };

  const dpr = prerenderDpr;
  const sprite = document.createElement("canvas");
  sprite.width = Math.ceil(drawSize * dpr);
  sprite.height = Math.ceil(drawSize * dpr);
  const g = sprite.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.scale(dpr, dpr);
  const maxDrawW = drawSize * SNACK_IMAGE_FIT * sizeBoost;
  const maxDrawH = drawSize * SNACK_IMAGE_FIT * sizeBoost;
  const fit = Math.min(maxDrawW / bounds.sw, maxDrawH / bounds.sh);
  const drawW = bounds.sw * fit;
  const drawH = bounds.sh * fit;
  g.drawImage(
    image,
    bounds.sx,
    bounds.sy,
    bounds.sw,
    bounds.sh,
    (drawSize - drawW) / 2,
    (drawSize - drawH) / 2,
    drawW,
    drawH
  );
  snackSpriteCache.set(key, sprite);
  return sprite;
}

function drawSnackSprite(snackId, x, y, size, alpha = 1) {
  const drawSize = snapSnackSpriteSize(size);
  const sprite = getSnackSprite(snackId, drawSize);
  if (!sprite) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(sprite, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
  ctx.restore();
}

function drawOverlayIconValue(iconValue, x, y, size, alpha = 1) {
  if (SNACK_BY_ID[iconValue]) {
    drawSnackSprite(iconValue, x, y, size, alpha);
    return;
  }

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "#d27b9d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillText(iconValue, x, y);
  ctx.restore();
}

/**
 * --- Audio (assets/audio/) ---
 * Browsers usually block sound until the player taps a key or the page — we start the
 * soft loop after the first gesture. Short sounds use `cloneNode()` so they can overlap
 * (rapid snack grabs). Audio starts on every visit, then the player can mute it in-session.
 */
const AUDIO_DIR = "assets/audio/";
const audioBgm = new Audio(`${AUDIO_DIR}corgi.mp3`);
const audioEat = new Audio(`${AUDIO_DIR}eat.mp3`);
const audioHit = new Audio(`${AUDIO_DIR}hit.mp3`);
const audioWin = new Audio(`${AUDIO_DIR}levelup.mp3`);

/** Keep BGM under SFX so the mix feels gentle (tweak here only). */
const AUDIO_VOL = {
  bgm: 0.16,
  eat: 0.28,
  hit: 0.34,
  win: 0.32,
};

let audioMuted = false;
/** True after a real user gesture (tap / key). Browsers need this before `play()` is allowed. */
let audioGestureOk = false;

function configureAudio() {
  audioBgm.loop = true;
  audioBgm.volume = AUDIO_VOL.bgm;
  audioEat.volume = AUDIO_VOL.eat;
  audioHit.volume = AUDIO_VOL.hit;
  audioWin.volume = AUDIO_VOL.win;
  for (const a of [audioBgm, audioEat, audioHit, audioWin]) {
    a.preload = "auto";
  }
}

function syncAudioMuteFlags() {
  for (const a of [audioBgm, audioEat, audioHit, audioWin]) {
    a.muted = audioMuted;
  }
}

function updateAudioButton() {
  if (!elAudioBtn) return;
  elAudioBtn.setAttribute("aria-pressed", audioMuted ? "true" : "false");
  elAudioBtn.textContent = audioMuted ? "Muted" : "Sound";
  elAudioBtn.title = audioMuted ? "Unmute game audio" : "Mute game audio";
}

function applyAudioMuteUi() {
  syncAudioMuteFlags();
  if (audioMuted) {
    audioBgm.pause();
  }
  updateAudioButton();
}

/** Start or resume the loop whenever we’re unmuted and autoplay is allowed (not “only once”). */
function tryStartBackgroundMusic() {
  if (audioMuted || !audioGestureOk) return;
  const p = audioBgm.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}

function unlockAudioFromUserGesture() {
  audioGestureOk = true;
  tryStartBackgroundMusic();
}

/** Overlapping-friendly one-shot (snacks, hits). */
function playSoundClone(template) {
  if (audioMuted) return;
  const clip = template.cloneNode();
  clip.volume = template.volume;
  clip.muted = false;
  const p = clip.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

function playEatSound() {
  playSoundClone(audioEat);
}

function playHitSound() {
  playSoundClone(audioHit);
}

function playWinSound() {
  if (audioMuted) return;
  const p = audioWin.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

function toggleAudioMuted() {
  // Any use of this control is a user gesture — needed so Space/Enter on the button can resume audio.
  audioGestureOk = true;
  audioMuted = !audioMuted;
  applyAudioMuteUi();
  if (!audioMuted) tryStartBackgroundMusic();
}

configureAudio();
applyAudioMuteUi();

const PLAYER_SPRITE_SRC = Object.freeze({
  right: "assets/images/player.corgi.right.png",
  left: "assets/images/player.corgi.left.png",
});

const playerSpriteStatus = {
  right: "loading",
  left: "loading",
};

function loadImageAsset(src, key) {
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    playerSpriteStatus[key] = "ready";
  });
  image.addEventListener("error", () => {
    playerSpriteStatus[key] = "error";
    console.error(`[player-sprite] Failed to load ${src}`);
  });
  image.src = src;
  return image;
}

function imageLoaded(image) {
  return Boolean(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
}

const playerSprites = {
  right: loadImageAsset(PLAYER_SPRITE_SRC.right, "right"),
  left: loadImageAsset(PLAYER_SPRITE_SRC.left, "left"),
};

const CAT_SPRITE_SRC = Object.freeze({
  right: "assets/images/cat.right.png",
  left: "assets/images/cat.left.png",
});

const catSpriteStatus = {
  right: "loading",
  left: "loading",
};

function loadCatImageAsset(src, key) {
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    catSpriteStatus[key] = "ready";
  });
  image.addEventListener("error", () => {
    catSpriteStatus[key] = "error";
    console.error(`[cat-sprite] Failed to load ${src}`);
  });
  image.src = src;
  return image;
}

const catSprites = {
  right: loadCatImageAsset(CAT_SPRITE_SRC.right, "right"),
  left: loadCatImageAsset(CAT_SPRITE_SRC.left, "left"),
};

/** Maze wall / hedge tile art (transparent PNG). */
const BUSH_WALL_SRC = "assets/images/bush.png";
const bushWallImage = new Image();
bushWallImage.decoding = "async";
bushWallImage.addEventListener("error", () => {
  console.error(`[bush-wall] Failed to load ${BUSH_WALL_SRC}`);
});
bushWallImage.src = BUSH_WALL_SRC;

/** Inset from tile edge when drawing bush PNG (keeps a consistent gutter in every cell). */
const BUSH_WALL_TILE_PADDING = TILE * 0.1;

if (elAudioBtn) {
  elAudioBtn.addEventListener("click", () => {
    toggleAudioMuted();
  });
}

window.addEventListener(
  "pointerdown",
  () => {
    unlockAudioFromUserGesture();
  },
  { passive: true }
);

// --- Derived layout ---
const COLS = LEVELS[0].maze[0].length;
const ROWS = LEVELS[0].maze.length;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;
/** Gutter for the soft frame outside hedges — kept small so the board fills more of the canvas. */
const FRAME_PAD = 18;
let currentLevelIndex = 0;
let catSpeed = LEVELS[0].catSpeed;
let levelTransitionUntil = 0;

canvas.width = WORLD_W + FRAME_PAD * 2;
canvas.height = WORLD_H + FRAME_PAD * 2;

// Grid + snack list
const grid = [];
const snacks = []; // { col, row, snackId, rim, glow }
const walkableCells = []; // { c, r } — used by the roaming target picker
const catPatrolAnchors = []; // one “hub” per broad maze region so patrol targets span the whole board
const catVisitTick = []; // last visit stamp per walkable tile (0 = never)
let catVisitStamp = 0;

function buildLevel() {
  const maze = LEVELS[currentLevelIndex].maze;
  grid.length = 0;
  snacks.length = 0;
  walkableCells.length = 0;
  catPatrolAnchors.length = 0;
  catVisitTick.length = 0;
  catVisitStamp = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    const visitRow = [];
    for (let c = 0; c < COLS; c++) {
      const ch = maze[r][c];
      visitRow.push(0);
      if (ch === "#") row.push(WALL);
      else if (ch === ".") {
        row.push(SNACK);
        walkableCells.push({ c, r });
        const si = (c + r + currentLevelIndex * 3) % SNACK_SET.length;
        const snack = SNACK_SET[si];
        snacks.push({
          col: c,
          row: r,
          snackId: snack.id,
          rim: snack.rim,
          glow: snack.glow,
        });
      } else {
        row.push(EMPTY);
        walkableCells.push({ c, r });
      }
    }
    grid.push(row);
    catVisitTick.push(visitRow);
  }

  buildCatPatrolAnchors();
}

// Player — wide sprite footprint for art; tighter logical hitbox for walls/turns (forgiving casual feel).
const PLAYER_W = TILE * 0.72;
const PLAYER_H = TILE * 0.72;
/** Inset wall/turn rect (centered under sprite). Smaller = easier lane threading without clipping bushes. */
const PLAYER_HIT_W = TILE * 0.52;
const PLAYER_HIT_H = TILE * 0.52;
/** Draw-only scale so the corgi reads as the focal point (hitbox unchanged). */
const CORGI_DRAW_SCALE = 1.12;
const PLAYER_SPRITE_BOX_SCALE = 1.7;
const PLAYER_SPRITE_Y_OFFSET = TILE * 0.02;

const player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  pickupPop: 0, // 0..~1, decays; brief draw scale
  facingDirection: "right",
};

function playerHitInsetX() {
  return (PLAYER_W - PLAYER_HIT_W) * 0.5;
}
function playerHitInsetY() {
  return (PLAYER_H - PLAYER_HIT_H) * 0.5;
}
function playerHitLeft() {
  return player.x + playerHitInsetX();
}
function playerHitTop() {
  return player.y + playerHitInsetY();
}
/** Wall probe for the corgi — uses logical hitbox only (sprite can stay large/cute). */
function rectHitsPlayerWall() {
  return rectHitsWall(playerHitLeft(), playerHitTop(), PLAYER_HIT_W, PLAYER_HIT_H);
}

/**
 * All enemy helpers below still read from `cat`, but Levels 4-5 need two cats.
 * We keep one shared AI pathing system by temporarily pointing `cat` at whichever
 * enemy is being updated or drawn.
 */
let cat = null;
const cats = [];

function createCatState() {
  return {
    x: 0,
    y: 0,
    vx: CAT_SPEED,
    vy: 0,
    lastFacingLeft: false,
    /** After choosing a branch, wait before re-picking (stops jitter on tile center). */
    branchCooldownUntil: 0,
    /** Pixels integrated along current velocity since last committed direction change (junction / wall pick). */
    travelSinceDecisionPx: 0,
    roamTarget: null,
    roamMap: null,
    preferEdgeTarget: false,
    targetChoiceCountdown: 0,
    lastCellC: -1,
    lastCellR: -1,
    recentTargetRegions: [],
    recentTrail: [],
    roundStartMs: 0,
    /** After anti-stuck: score branches stronger toward roam target / away from trail until this time. */
    escapeScoreBoostUntil: 0,
  };
}

/** @type {{ x: number, y: number, vx: number, vy: number, life: number, snackId: string }[]} */
const pickupParticles = [];
const celebrationSparkles = [];

const keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

let mode = "playing"; // start | playing | level-complete | gamecomplete | gameover

let lives = MAX_LIVES;
/** After `loseLife()`, enemies skip their update until this timestamp (ms). */
let enemyFreezeUntil = 0;
let respawnMsgActive = false;
let snackStreak = 0;
let nextCelebrationStreak = STREAK_CELEBRATION.snacksPerParty;
let celebrationLastStreak = 0;
let celebrationUntil = 0;
let celebrationSpawnCarry = 0;

function getCurrentLevel() {
  return LEVELS[currentLevelIndex];
}

function getNextLevel() {
  return LEVELS[currentLevelIndex + 1] || null;
}

function updateCanvasCursor() {
  canvas.style.cursor =
    mode === "start" || mode === "gameover" || mode === "gamecomplete" ? "pointer" : "default";
}

function celebrationActive() {
  return performance.now() < celebrationUntil;
}

function celebrationVisualsActive() {
  return mode === "playing" && celebrationActive();
}

function updateCelebrationBannerUi() {
  const active = celebrationVisualsActive();
  const streakValue = celebrationLastStreak || STREAK_CELEBRATION.snacksPerParty;
  if (elStreakBanner) {
    elStreakBanner.setAttribute("aria-hidden", active ? "false" : "true");
  }
  if (elStreakBannerTitle) {
    elStreakBannerTitle.textContent = `${streakValue} Snack Streak!`;
  }
}

function applyCelebrationUi() {
  bodyEl.classList.toggle("celebration-mode", celebrationVisualsActive());
  updateCelebrationBannerUi();
}

function setMode(nextMode) {
  mode = nextMode;
  updateCanvasCursor();
  applyCelebrationUi();
}

function clearInputState() {
  keys.ArrowUp = false;
  keys.ArrowDown = false;
  keys.ArrowLeft = false;
  keys.ArrowRight = false;
  requestedDirection = null;
  requestedExpireAt = 0;
  requestedLastKeydownAt = 0;
}

function resetSnackStreakProgress() {
  snackStreak = 0;
  nextCelebrationStreak = STREAK_CELEBRATION.snacksPerParty;
  celebrationLastStreak = 0;
}

function stopCelebrationMode() {
  celebrationUntil = 0;
  celebrationSpawnCarry = 0;
  celebrationSparkles.length = 0;
  applyCelebrationUi();
}

function resetCelebrationRunState() {
  resetSnackStreakProgress();
  stopCelebrationMode();
}

function getLevelCatSpawns(level = getCurrentLevel()) {
  if (Array.isArray(level.catSpawns) && level.catSpawns.length > 0) return level.catSpawns;
  if (level.catSpawn) return [level.catSpawn];
  return [];
}

function withCat(activeCat, fn) {
  const prevCat = cat;
  cat = activeCat;
  try {
    return fn();
  } finally {
    cat = prevCat;
  }
}

function initCats() {
  cats.length = 0;
  for (const spawn of getLevelCatSpawns()) {
    const enemy = createCatState();
    cats.push(enemy);
    withCat(enemy, () => initCat(spawn));
  }
  cat = cats[0] || null;
}

function updateCats(dt) {
  for (const enemy of cats) {
    const hitPlayer = withCat(enemy, () => {
      updateCat(dt);
      return catTouchesPlayer();
    });
    if (hitPlayer) return true;
  }
  return false;
}

function drawCats() {
  for (const enemy of cats) {
    withCat(enemy, () => drawCat());
  }
}

function updateHud() {
  elSnack.textContent = String(snacks.length);
  if (elLevel) elLevel.textContent = String(currentLevelIndex + 1);
  if (!elLives) return;
  elLives.innerHTML = "";
  for (let i = 0; i < MAX_LIVES; i++) {
    const span = document.createElement("span");
    span.className = i < lives ? "heart-full" : "heart-empty";
    span.textContent = i < lives ? "♥" : "♡";
    span.setAttribute("aria-hidden", "true");
    elLives.appendChild(span);
  }
  elLives.setAttribute("aria-label", `${lives} of ${MAX_LIVES} lives`);
}

/** When true, enemies do not move (after the player loses a life, for a few seconds). */
function enemiesAreFrozen() {
  return performance.now() < enemyFreezeUntil;
}

/** Safe spawn — same cell as a fresh round; does not rebuild the maze. */
function placePlayerAtStart() {
  player.x = START_COL * TILE + (TILE - PLAYER_W) / 2;
  player.y = START_ROW * TILE + (TILE - PLAYER_H) / 2;
  player.vx = 0;
  player.vy = 0;
  player.pickupPop = 0;
  player.facingDirection = "right";
  currentDirection = "right";
  requestedDirection = null;
  requestedExpireAt = 0;
  requestedLastKeydownAt = 0;

  if (rectHitsPlayerWall()) {
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (grid[r][c] !== WALL) {
          player.x = c * TILE + (TILE - PLAYER_W) / 2;
          player.y = r * TILE + (TILE - PLAYER_H) / 2;
          return;
        }
      }
    }
  }
}

/**
 * Call when an enemy catches the corgi. Keeps snacks/progress; respawns player.
 * On last life → game over (press R for full reset).
 */
function loseLife() {
  if (mode !== "playing") return;

  lives -= 1;
  playHitSound();
  pickupParticles.length = 0;
  resetSnackStreakProgress();
  stopCelebrationMode();

  if (lives <= 0) {
    setMode("gameover");
    enemyFreezeUntil = 0;
    respawnMsgActive = false;
    player.vx = 0;
    player.vy = 0;
    clearInputState();
    elStatus.textContent = "Game over. Press Space, tap, or R to replay.";
    updateHud();
    return;
  }

  placePlayerAtStart();
  enemyFreezeUntil =
    performance.now() + RESPAWN_FREEZE_MIN_MS + Math.random() * (RESPAWN_FREEZE_MAX_MS - RESPAWN_FREEZE_MIN_MS);
  respawnMsgActive = true;
  elStatus.textContent = `Ouch! ${lives} ${lives === 1 ? "life" : "lives"} left — enemies are paused for a few seconds.`;
  updateHud();
}

function loadLevel(index, resetLives = false) {
  currentLevelIndex = index;
  catSpeed = getCurrentLevel().catSpeed;
  buildLevel();
  if (resetLives) lives = MAX_LIVES;
  if (resetLives) resetSnackStreakProgress();
  enemyFreezeUntil = 0;
  respawnMsgActive = false;
  stopCelebrationMode();
  setMode("playing");
  levelTransitionUntil = 0;
  elStatus.textContent = getCurrentLevel().title;
  pickupParticles.length = 0;

  initCats();
  placePlayerAtStart();
  updateHud();
}

function resetGame() {
  clearInputState();
  loadLevel(0, true);
}

function showStartScreen() {
  clearInputState();
  loadLevel(0, true);
  player.vx = 0;
  player.vy = 0;
  respawnMsgActive = false;
  setMode("start");
  elStatus.textContent = "Press Space or tap to start.";
}

function beginRunFromStartScreen() {
  if (mode !== "start") return;
  unlockAudioFromUserGesture();
  clearInputState();
  player.vx = 0;
  player.vy = 0;
  setMode("playing");
  elStatus.textContent = getCurrentLevel().title;
}

function handlePrimaryScreenAction() {
  if (mode === "start") {
    beginRunFromStartScreen();
    return true;
  }
  if (mode === "gameover" || mode === "gamecomplete") {
    unlockAudioFromUserGesture();
    resetGame();
    return true;
  }
  return false;
}

function beginLevelComplete() {
  const nextLevel = getNextLevel();
  player.vx = 0;
  player.vy = 0;
  respawnMsgActive = false;
  enemyFreezeUntil = 0;
  stopCelebrationMode();
  playWinSound();

  if (!nextLevel) {
    setMode("gamecomplete");
    elStatus.textContent = `You cleared all ${TOTAL_LEVELS} levels! Press Space, tap, or R to play again.`;
    return;
  }

  setMode("level-complete");
  levelTransitionUntil = performance.now() + LEVEL_TRANSITION_MS;
  elStatus.textContent = `${getCurrentLevel().title} complete. Next: ${nextLevel.title}.`;
}

function advanceToNextLevel() {
  const nextIndex = currentLevelIndex + 1;
  if (nextIndex >= TOTAL_LEVELS) {
    setMode("gamecomplete");
    elStatus.textContent = `You cleared all ${TOTAL_LEVELS} levels! Press Space, tap, or R to play again.`;
    return;
  }
  loadLevel(nextIndex);
}

function rectHitsWall(x, y, w, h) {
  const c0 = Math.floor(x / TILE);
  const c1 = Math.floor((x + w - 1e-6) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + h - 1e-6) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
      if (grid[r][c] === WALL) return true;
    }
  }
  return false;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Tile under the cat’s center (for path choices). */
function catCenterCR() {
  const cx = cat.x + CAT_W / 2;
  const cy = cat.y + CAT_H / 2;
  return { c: Math.floor(cx / TILE), r: Math.floor(cy / TILE) };
}

/** Open cardinals from a grid cell (not a wall). */
function catWalkableCardinalsFromCell(c, r) {
  const S = catSpeed;
  const out = [];
  for (const [dc, dr, vx, vy] of [
    [-1, 0, -S, 0],
    [1, 0, S, 0],
    [0, -1, 0, -S],
    [0, 1, 0, S],
  ]) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    if (grid[nr][nc] === WALL) continue;
    out.push({ dc, dr, vx, vy });
  }
  return out;
}

function catIsNearTileCenter() {
  const cx = cat.x + CAT_W / 2;
  const cy = cat.y + CAT_H / 2;
  const colMid = Math.floor(cx / TILE) * TILE + TILE / 2;
  const rowMid = Math.floor(cy / TILE) * TILE + TILE / 2;
  const t = TILE * 0.28; // a bit more forgiving; axis-only avoids skipping junctions
  if (Math.abs(cat.vx) > Math.abs(cat.vy) + 1e-3) {
    return Math.abs(cy - rowMid) < t;
  }
  if (Math.abs(cat.vy) > 1e-3) {
    return Math.abs(cx - colMid) < t;
  }
  return Math.abs(cx - colMid) < t && Math.abs(cy - rowMid) < t;
}

/** Two-way hallway: only forward + reverse — no junction choice here. */
function catIsStraightHallway(opts, odc, odr) {
  if (opts.length !== 2) return false;
  const hasRev = opts.some((p) => p.dc === -odc && p.dr === -odr);
  const hasFwd = opts.some((p) => p.dc === odc && p.dr === odr);
  return hasRev && hasFwd;
}

function catMarkVisitedCurrentCell(force = false) {
  const { c, r } = catCenterCR();
  if (!force && c === cat.lastCellC && r === cat.lastCellR) return;
  cat.lastCellC = c;
  cat.lastCellR = r;
  catVisitStamp += 1;
  catVisitTick[r][c] = catVisitStamp;
  catPushRecentTrail(c, r);
}

function catCellVisitAge(c, r) {
  const tick = catVisitTick[r]?.[c] ?? 0;
  if (tick === 0) return 999;
  return catVisitStamp - tick;
}

function catCellId(c, r) {
  return r * COLS + c;
}

function catPushRecentTrail(c, r) {
  const id = catCellId(c, r);
  const trail = cat.recentTrail;
  if (trail[trail.length - 1] === id) return;
  trail.push(id);
  if (trail.length > CAT_AI.RECENT_TRAIL_LIMIT) trail.shift();
}

function catTrailIncludes(c, r) {
  return cat.recentTrail.includes(catCellId(c, r));
}

/**
 * Stronger only at the start of a round: begins near 1, then eases down to 0.
 * We square the fade so the first few seconds get a noticeable push out of the spawn pocket.
 */
function catEarlyExploreMix() {
  if (cat.roundStartMs <= 0) return 0;
  const t = (performance.now() - cat.roundStartMs) / CAT_AI.EARLY_EXPLORE_MS;
  const linear = 1 - Math.max(0, Math.min(1, t));
  return linear * linear;
}

/**
 * Seed the immediate spawn neighborhood as "recently used" so the opening decisions
 * treat that local pocket as slightly stale and leave it sooner.
 */
function catSeedSpawnAreaMemory(startC, startR) {
  const seen = new Set([catCellId(startC, startR)]);
  const queue = [{ c: startC, r: startR, depth: 0 }];
  const seeded = [];
  let qi = 0;

  while (qi < queue.length) {
    const { c, r, depth } = queue[qi];
    qi += 1;

    if (depth > 0) seeded.push({ c, r, depth });
    if (depth >= CAT_AI.SPAWN_MEMORY_DEPTH) continue;

    for (const p of catWalkableCardinalsFromCell(c, r)) {
      const nc = c + p.dc;
      const nr = r + p.dr;
      const id = catCellId(nc, nr);
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push({ c: nc, r: nr, depth: depth + 1 });
    }
  }

  // Push farther cells first, then near cells last so the nearest loop reads as most recent.
  seeded.sort((a, b) => b.depth - a.depth);
  for (const cell of seeded) {
    catVisitStamp += 1;
    catVisitTick[cell.r][cell.c] = catVisitStamp;
    catPushRecentTrail(cell.c, cell.r);
  }
}

function catIsEdgeLane(c, r) {
  const m = CAT_AI.EDGE_MARGIN;
  return c <= m || r <= m || c >= COLS - 1 - m || r >= ROWS - 1 - m;
}

function buildCatPatrolAnchors() {
  catPatrolAnchors.length = 0;

  for (let rr = 0; rr < CAT_AI.REGION_ROWS; rr++) {
    for (let rc = 0; rc < CAT_AI.REGION_COLS; rc++) {
      const c0 = Math.floor((rc * COLS) / CAT_AI.REGION_COLS);
      const c1 = Math.floor(((rc + 1) * COLS) / CAT_AI.REGION_COLS) - 1;
      const r0 = Math.floor((rr * ROWS) / CAT_AI.REGION_ROWS);
      const r1 = Math.floor(((rr + 1) * ROWS) / CAT_AI.REGION_ROWS) - 1;
      const midC = (c0 + c1) / 2;
      const midR = (r0 + r1) / 2;

      let best = null;
      let bestScore = -Infinity;

      for (const cell of walkableCells) {
        if (cell.c < c0 || cell.c > c1 || cell.r < r0 || cell.r > r1) continue;

        const degree = catWalkableCardinalsFromCell(cell.c, cell.r).length;
        if (degree === 0) continue;

        const junctionBonus = degree >= 3 ? 3.4 : degree === 2 ? 1.1 : 0;
        const centerPenalty = (Math.abs(cell.c - midC) + Math.abs(cell.r - midR)) * 0.45;
        const edgeBonus = catIsEdgeLane(cell.c, cell.r) ? 0.35 : 0;
        const score = junctionBonus + edgeBonus - centerPenalty;

        if (score > bestScore) {
          bestScore = score;
          best = cell;
        }
      }

      if (best) {
        catPatrolAnchors.push({
          id: catPatrolAnchors.length,
          c: best.c,
          r: best.r,
          regionId: rr * CAT_AI.REGION_COLS + rc,
          edge: catIsEdgeLane(best.c, best.r),
        });
      }
    }
  }
}

function catRegionForCell(c, r) {
  const rc = Math.min(CAT_AI.REGION_COLS - 1, Math.floor((c * CAT_AI.REGION_COLS) / COLS));
  const rr = Math.min(CAT_AI.REGION_ROWS - 1, Math.floor((r * CAT_AI.REGION_ROWS) / ROWS));
  return {
    c: rc,
    r: rr,
    id: rr * CAT_AI.REGION_COLS + rc,
  };
}

function catRegionDistance(a, b) {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
}

function catRememberTargetRegion(regionId) {
  const recent = cat.recentTargetRegions;
  if (recent[recent.length - 1] === regionId) return;
  recent.push(regionId);
  if (recent.length > CAT_AI.RECENT_TARGET_REGION_COUNT) {
    recent.shift();
  }
}

function catSetBranchCooldown() {
  cat.branchCooldownUntil =
    performance.now() +
    CAT_AI.COOLDOWN_MS[0] +
    Math.random() * (CAT_AI.COOLDOWN_MS[1] - CAT_AI.COOLDOWN_MS[0]);
}

function catResetTargetChoiceCountdown() {
  const [lo, hi] = CAT_AI.TARGET_CHOICE_RANGE;
  cat.targetChoiceCountdown = lo + Math.floor(Math.random() * (hi - lo + 1));
}

function catSpendRoamChoice() {
  cat.targetChoiceCountdown = Math.max(0, cat.targetChoiceCountdown - 1);
}

function catBuildDistanceMap(targetC, targetR) {
  const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
  const queue = [{ c: targetC, r: targetR }];
  dist[targetR][targetC] = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    const { c, r } = queue[qi];
    const nextD = dist[r][c] + 1;
    for (const p of catWalkableCardinalsFromCell(c, r)) {
      const nc = c + p.dc;
      const nr = r + p.dr;
      if (nextD >= dist[nr][nc]) continue;
      dist[nr][nc] = nextD;
      queue.push({ c: nc, r: nr });
    }
  }

  return dist;
}

function catDistanceToRoamTarget(c, r) {
  if (!cat.roamMap || !cat.roamMap[r]) return Infinity;
  return cat.roamMap[r][c];
}

function catNeedsNewRoamTarget(force = false) {
  if (force || !cat.roamTarget || !cat.roamMap) return true;
  if (cat.targetChoiceCountdown <= 0) return true;
  const { c, r } = catCenterCR();
  return catDistanceToRoamTarget(c, r) <= CAT_AI.TARGET_REACHED_DIST;
}

function catChooseRoamTarget(force = false) {
  if (!catNeedsNewRoamTarget(force)) return;

  const { c: hereC, r: hereR } = catCenterCR();
  const hereRegion = catRegionForCell(hereC, hereR);
  const fromHereMap = catBuildDistanceMap(hereC, hereR);
  const mazeMidC = (COLS - 1) / 2;
  const mazeMidR = (ROWS - 1) / 2;
  const earlyMix = catEarlyExploreMix();
  const minTargetDist = CAT_AI.MIN_TARGET_DIST + earlyMix * CAT_AI.EARLY_MIN_TARGET_DIST_BOOST;
  cat.preferEdgeTarget = !cat.preferEdgeTarget;

  let best = null;
  let bestScore = -Infinity;

  for (const anchor of catPatrolAnchors) {
    if (anchor.c === hereC && anchor.r === hereR) continue;

    const pathDist = fromHereMap[anchor.r]?.[anchor.c] ?? Infinity;
    if (!Number.isFinite(pathDist)) continue;

    const targetRegion = catRegionForCell(anchor.c, anchor.r);
    const regionDist = catRegionDistance(hereRegion, targetRegion);
    if (!force && pathDist < minTargetDist && regionDist < 2) continue;

    const wantsEdge = cat.preferEdgeTarget;
    const styleBonus = anchor.edge === wantsEdge ? 6.2 : 0;
    const freshnessBonus = Math.min(10, catCellVisitAge(anchor.c, anchor.r)) * 0.22;
    const sideSwapBonus =
      (Math.sign(anchor.c - mazeMidC) !== Math.sign(hereC - mazeMidC) ? CAT_AI.BONUS_SIDE_SWAP : 0) +
      (Math.sign(anchor.r - mazeMidR) !== Math.sign(hereR - mazeMidR) ? CAT_AI.BONUS_SIDE_SWAP * 0.85 : 0);
    const sameRegionPenalty = targetRegion.id === hereRegion.id ? CAT_AI.SAME_REGION_PENALTY : 0;
    const recentRegionPenalty = cat.recentTargetRegions.includes(targetRegion.id) ? CAT_AI.RECENT_REGION_PENALTY : 0;
    const score =
      pathDist * (1.18 + earlyMix * 0.18) +
      regionDist * (CAT_AI.BONUS_REGION_DISTANCE + earlyMix * 0.35) +
      styleBonus +
      freshnessBonus +
      sideSwapBonus * (1 + earlyMix * CAT_AI.EARLY_SIDE_SWAP_MULT) -
      sameRegionPenalty -
      recentRegionPenalty * (1 + earlyMix * 0.22) +
      Math.random() * 0.45;

    if (score > bestScore) {
      bestScore = score;
      best = anchor;
    }
  }

  if (!best && catPatrolAnchors.length > 0) {
    best = catPatrolAnchors[Math.floor(Math.random() * catPatrolAnchors.length)];
  }
  if (!best) return;

  cat.roamTarget = {
    c: best.c,
    r: best.r,
    edge: catIsEdgeLane(best.c, best.r),
  };
  cat.roamMap = catBuildDistanceMap(best.c, best.r);
  catRememberTargetRegion(catRegionForCell(best.c, best.r).id);
  catResetTargetChoiceCountdown();
}

/**
 * Follow a candidate direction through any forced corridor turns so we score the whole
 * branch, not just the next tile. This makes the cat leave stale local loops sooner.
 */
function catTraceDirection(startC, startR, startDc, startDr) {
  const cells = [];
  let c = startC;
  let r = startR;
  let dc = startDc;
  let dr = startDr;

  for (let i = 0; i < CAT_AI.LOOKAHEAD_STEPS; i++) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) break;
    if (grid[nr][nc] === WALL) break;

    c = nc;
    r = nr;
    cells.push({ c, r });

    const opts = catWalkableCardinalsFromCell(c, r);
    const nonBacktrack = opts.filter((p) => !(p.dc === -dc && p.dr === -dr));
    if (nonBacktrack.length !== 1) break;

    dc = nonBacktrack[0].dc;
    dr = nonBacktrack[0].dr;
  }

  return { cells, endC: c, endR: r };
}

function catAreaFreshnessFrom(startC, startR) {
  const seen = new Set([catCellId(startC, startR)]);
  const queue = [{ c: startC, r: startR, depth: 0 }];
  let qi = 0;
  let freshSum = 0;
  let recentSum = 0;
  let weightSum = 0;

  while (qi < queue.length) {
    const { c, r, depth } = queue[qi];
    qi += 1;

    const weight = CAT_AI.EXPLORE_DEPTH - depth + 1;
    const age = Math.min(CAT_AI.VISIT_AGE_CAP, catCellVisitAge(c, r));
    freshSum += age * weight;
    if (catTrailIncludes(c, r)) recentSum += weight;
    weightSum += weight;

    if (depth >= CAT_AI.EXPLORE_DEPTH) continue;
    for (const p of catWalkableCardinalsFromCell(c, r)) {
      const nc = c + p.dc;
      const nr = r + p.dr;
      const id = catCellId(nc, nr);
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push({ c: nc, r: nr, depth: depth + 1 });
    }
  }

  return {
    avgFreshness: weightSum > 0 ? freshSum / weightSum : 0,
    recentDensity: weightSum > 0 ? recentSum / weightSum : 0,
  };
}

/**
 * Score a full branch from the current intersection:
 * - prefers progress toward the current roam target
 * - prefers less recently visited corridors / areas
 * - heavily dislikes re-entering the recent trail
 * - keeps a little forward bias so motion still reads arcade-like
 */
function catScoreDirection(p, odc, odr, applyForwardBonus, applyReversePenalty) {
  const { c, r } = catCenterCR();
  const forward = p.dc === odc && p.dr === odr;
  const reverse = p.dc === -odc && p.dr === -odr;
  const trace = catTraceDirection(c, r, p.dc, p.dr);
  const { endC, endR } = trace;
  const hereRegion = catRegionForCell(c, r);
  const endRegion = catRegionForCell(endC, endR);
  const targetRegion = cat.roamTarget ? catRegionForCell(cat.roamTarget.c, cat.roamTarget.r) : null;
  const branchArea = catAreaFreshnessFrom(endC, endR);
  const earlyMix = catEarlyExploreMix();
  const esc =
    cat.escapeScoreBoostUntil && performance.now() < cat.escapeScoreBoostUntil
      ? { roam: CAT_AI.ESCAPE_ROAM_PROGRESS_MULT, trail: CAT_AI.ESCAPE_TRAIL_MULT }
      : { roam: 1, trail: 1 };
  let score = 0;

  if (forward && applyForwardBonus) score += CAT_AI.BONUS_FORWARD * (1 - earlyMix * CAT_AI.EARLY_FORWARD_FADE);
  if (reverse && applyReversePenalty) score -= CAT_AI.PENALTY_REVERSE;

  const nextId = catCellId(c + p.dc, r + p.dr);
  let stepOntoRecent = 0;
  const tr = cat.recentTrail;
  const stepLook = 14;
  for (let i = Math.max(0, tr.length - stepLook); i < tr.length; i++) {
    if (tr[i] === nextId) stepOntoRecent += 1;
  }
  score -= stepOntoRecent * CAT_AI.PENALTY_RECENT_STEP_TILE * esc.trail;

  const trailHits = trace.cells.reduce((sum, cell) => sum + (catTrailIncludes(cell.c, cell.r) ? 1 : 0), 0);
  score -= trailHits * (CAT_AI.PENALTY_RECENT_TRAIL + earlyMix * CAT_AI.EARLY_TRAIL_PENALTY_BOOST) * esc.trail;

  score += branchArea.avgFreshness * (CAT_AI.BONUS_BRANCH_FRESHNESS + earlyMix * CAT_AI.EARLY_BRANCH_FRESHNESS_BOOST);
  score -= branchArea.recentDensity * (CAT_AI.PENALTY_LOCAL_LOOP + earlyMix * CAT_AI.EARLY_LOOP_PENALTY_BOOST);

  const roamNow = catDistanceToRoamTarget(c, r);
  const roamNext = catDistanceToRoamTarget(endC, endR);
  if (Number.isFinite(roamNow) && Number.isFinite(roamNext)) {
    score +=
      (roamNow - roamNext) *
      (CAT_AI.BONUS_TARGET_PROGRESS + earlyMix * CAT_AI.EARLY_TARGET_PROGRESS_BOOST) *
      esc.roam;
  }

  const regionJump = catRegionDistance(hereRegion, endRegion);
  score += regionJump * (CAT_AI.BONUS_BRANCH_REGION + earlyMix * CAT_AI.EARLY_BRANCH_REGION_BOOST);
  if (targetRegion && endRegion.id === targetRegion.id) score += CAT_AI.BONUS_TARGET_REGION;

  const px = Math.floor((player.x + PLAYER_W / 2) / TILE);
  const py = Math.floor((player.y + PLAYER_H / 2) / TILE);
  const dNow = Math.abs(c - px) + Math.abs(r - py);
  const dNext = Math.abs(endC - px) + Math.abs(endR - py);
  if (dNow <= CAT_AI.CHASE_RANGE_TILES && dNext < dNow) {
    score += CAT_AI.BONUS_CHASE * (1 - earlyMix * CAT_AI.EARLY_CHASE_FADE);
  }

  score += Math.random() * CAT_AI.DECISION_JITTER;
  return score;
}

function catPickBestDirection(pool, odc, odr, applyForwardBonus, applyReversePenalty) {
  let best = pool[0];
  let bestScore = -Infinity;

  for (const p of pool) {
    const score = catScoreDirection(p, odc, odr, applyForwardBonus, applyReversePenalty);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

/**
 * True where the cat must pick (not a straight two-way corridor segment).
 * Includes T/+ junctions and L-corners; excludes hallways with only forward + reverse.
 */
function catIsDecisionTile(opts, odc, odr) {
  if (opts.length < 2) return false;
  if (catIsStraightHallway(opts, odc, odr)) return false;
  return true;
}

/**
 * When centered on a tile at a real intersection/corner, score branches once — not every frame.
 * Requires minimum travel since last choice so cats don’t orbit the same tile band.
 */
function catTryDecisionPointChoice() {
  if (performance.now() < cat.branchCooldownUntil) return;
  if (!catIsNearTileCenter()) return;
  if (Math.abs(cat.vx) + Math.abs(cat.vy) < 1) return;
  if (cat.travelSinceDecisionPx < CAT_AI.MIN_COMMIT_TRAVEL_PX) return;

  const odc = Math.abs(cat.vx) > 1e-6 ? Math.sign(cat.vx) : 0;
  const odr = Math.abs(cat.vy) > 1e-6 ? Math.sign(cat.vy) : 0;
  const { c, r } = catCenterCR();
  const opts = catWalkableCardinalsFromCell(c, r);
  if (!catIsDecisionTile(opts, odc, odr)) return;

  catChooseRoamTarget();
  const nonRev = opts.filter((p) => !(p.dc === -odc && p.dr === -odr));
  const pool = nonRev.length > 0 ? nonRev : opts;
  const pick = catPickBestDirection(pool, odc, odr, true, pool.length > 1);
  if (pick.vx === cat.vx && pick.vy === cat.vy) return;

  catSpendRoamChoice();
  cat.vx = pick.vx;
  cat.vy = pick.vy;
  cat.travelSinceDecisionPx = 0;
  catSetBranchCooldown();
}

/** Detect tight oscillation / repeated visits and force a distant roam target + escape scoring. */
function catMaybeBreakLocalLoop() {
  const trail = cat.recentTrail;
  const win = CAT_AI.STUCK_TRAIL_WINDOW;
  if (trail.length < 8) return;

  const { c: cc, r: cr } = catCenterCR();
  const curId = catCellId(cc, cr);
  let revisitCur = 0;
  const rw = CAT_AI.STUCK_REVISIT_WINDOW;
  for (let i = Math.max(0, trail.length - rw); i < trail.length; i++) {
    if (trail[i] === curId) revisitCur++;
  }

  let tightLoop = false;
  if (trail.length >= win) {
    const slice = trail.slice(-win);
    const uniq = new Set(slice);
    if (uniq.size <= CAT_AI.STUCK_UNIQUE_TILES_MAX) tightLoop = true;
  }

  if (!tightLoop && revisitCur < CAT_AI.STUCK_REVISIT_MIN) return;

  catChooseRoamTarget(true);
  cat.escapeScoreBoostUntil = performance.now() + CAT_AI.ESCAPE_MS;
  cat.travelSinceDecisionPx = CAT_AI.MIN_COMMIT_TRAVEL_PX;
  cat.branchCooldownUntil = performance.now() + CAT_AI.COOLDOWN_MS[1];
}

/**
 * Spawn on an interior row that is **deep** (far from top/bottom belts), not only “longest run”.
 * That keeps the start off the outer highway when possible.
 */
function initCat(spawnOverride = null) {
  const level = getCurrentLevel();
  const rMin = 2;
  const rMax = ROWS - 3;
  let bestScore = -Infinity;
  let bestLen = 1;
  let bestRow = Math.floor((rMin + rMax) / 2);
  let bestStart = 1;
  let bestEnd = 1;

  for (let row = rMin; row <= rMax; row++) {
    const belt = Math.min(row - 1, ROWS - 2 - row);
    let runStart = -1;
    for (let c = 0; c <= COLS; c++) {
      const walk = c < COLS && grid[row][c] !== WALL;
      if (walk) {
        if (runStart < 0) runStart = c;
      } else if (runStart >= 0) {
        const len = c - runStart;
        const score = belt * 12 + len;
        if (score > bestScore) {
          bestScore = score;
          bestLen = len;
          bestRow = row;
          bestStart = runStart;
          bestEnd = c - 1;
        }
        runStart = -1;
      }
    }
  }

  const spawnPoint = spawnOverride || getLevelCatSpawns(level)[0] || null;
  const spawnC = spawnPoint ? spawnPoint.c : Math.floor((bestStart + bestEnd) / 2);
  const spawnR = spawnPoint ? spawnPoint.r : bestRow;
  cat.x = spawnC * TILE + (TILE - CAT_W) / 2;
  cat.y = spawnR * TILE + (TILE - CAT_H) / 2;
  cat.roamTarget = null;
  cat.roamMap = null;
  cat.preferEdgeTarget = false;
  cat.targetChoiceCountdown = 0;
  cat.lastCellC = -1;
  cat.lastCellR = -1;
  cat.recentTargetRegions.length = 0;
  cat.recentTrail.length = 0;
  cat.escapeScoreBoostUntil = 0;
  cat.roundStartMs = performance.now();
  catMarkVisitedCurrentCell(true);
  {
    const start = catCenterCR();
    catSeedSpawnAreaMemory(start.c, start.r);
  }
  catChooseRoamTarget(true);

  const cr = catCenterCR();
  const dirs = catWalkableCardinalsFromCell(cr.c, cr.r);
  if (dirs.length > 0) {
    const pick = catPickBestDirection(dirs, 0, 0, false, false);
    cat.vx = pick.vx;
    cat.vy = pick.vy;
  } else {
    cat.vx = catSpeed;
    cat.vy = 0;
  }

  if (rectHitsWall(cat.x, cat.y, CAT_W, CAT_H)) {
    cat.vx = -cat.vx;
    cat.vy = -cat.vy;
  }
  cat.lastFacingLeft = cat.vx < 0;
  cat.travelSinceDecisionPx = TILE * 1.1;
  // Hold initial heading briefly so the first “near center” windows don’t re-pick a branch
  // before the cat has left the spawn pocket.
  cat.branchCooldownUntil = performance.now() + 400;
}

function updateCat(dt) {
  if (enemiesAreFrozen()) return;

  const ovx = cat.vx;
  const ovy = cat.vy;
  const dx = ovx * dt;
  const dy = ovy * dt;

  cat.travelSinceDecisionPx += Math.abs(dx) + Math.abs(dy);

  let hitX = false;
  let hitY = false;
  if (Math.abs(dx) >= Math.abs(dy)) {
    hitX = moveCatWithWallCollision("x", dx);
    hitY = moveCatWithWallCollision("y", dy);
  } else {
    hitY = moveCatWithWallCollision("y", dy);
    hitX = moveCatWithWallCollision("x", dx);
  }

  if (hitX && ovx !== 0) {
    catPickNewDir(Math.sign(ovx), 0, ovx, ovy);
  }
  if (hitY && ovy !== 0) {
    catPickNewDir(0, Math.sign(ovy), ovx, ovy);
  }

  catMarkVisitedCurrentCell();
  catMaybeBreakLocalLoop();
  catTryDecisionPointChoice();

  if (Math.abs(cat.vx) > Math.abs(cat.vy) + 1e-6 && Math.abs(cat.vx) > 1) {
    cat.lastFacingLeft = cat.vx < 0;
  }
}

function catTouchesPlayer() {
  if (enemiesAreFrozen()) return false;
  return rectsOverlap(playerHitLeft(), playerHitTop(), PLAYER_HIT_W, PLAYER_HIT_H, cat.x, cat.y, CAT_W, CAT_H);
}

function getEnemyCardinalMoveDir() {
  const avx = Math.abs(cat.vx);
  const avy = Math.abs(cat.vy);
  if (avx < 1e-3 && avy < 1e-3) return "right";
  if (avx > avy + 1e-3) {
    if (cat.vx > 1) return "right";
    if (cat.vx < -1) return "left";
  } else {
    if (cat.vy < -1) return "up";
    if (cat.vy > 1) return "down";
  }
  return "right";
}

function getCatSpriteImage() {
  return cat.lastFacingLeft ? catSprites.left : catSprites.right;
}

/**
 * Kawaii cat PNG, same directional idea as the corgi: left/right are separate sprites,
 * up/down keep the last horizontal base sprite and rotate 90°.
 */
function drawCat() {
  const px = cat.x;
  const py = cat.y;
  const pw = CAT_W;
  const ph = CAT_H;
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const image = getCatSpriteImage();
  const dir = getEnemyCardinalMoveDir();
  const facing = cat.lastFacingLeft ? "left" : "right";
  const rotation = getSideViewSpriteRotation(dir, facing);
  const chill = enemiesAreFrozen();
  const moving = Math.abs(cat.vx) + Math.abs(cat.vy) > 1;
  const bob = Math.sin(performance.now() / 95) * (moving ? 1.15 : 0.4);
  if (!imageLoaded(image)) {
    return;
  }

  const maxW = pw * CAT_SPRITE_BOX_SCALE;
  const maxH = ph * CAT_SPRITE_BOX_SCALE;
  const iw = image.naturalWidth || 1;
  const ih = image.naturalHeight || 1;
  const fit = Math.min(maxW / iw, maxH / ih);
  const drawW = iw * fit;
  const drawH = ih * fit;

  ctx.save();
  ctx.translate(cx, cy + bob);
  if (chill) ctx.globalAlpha = 0.48;
  ctx.fillStyle = "rgba(80, 95, 120, 0.16)";
  ctx.beginPath();
  ctx.ellipse(0, drawH * 0.35, drawW * 0.3, drawH * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.rotate(rotation);
  ctx.drawImage(image, -drawW / 2, -drawH / 2 + CAT_SPRITE_Y_OFFSET, drawW, drawH);
  ctx.restore();
}

function moveCatWithWallCollision(axis, delta) {
  if (delta === 0) return false;
  if (axis === "x") {
    cat.x += delta;
    if (rectHitsWall(cat.x, cat.y, CAT_W, CAT_H)) {
      if (delta > 0) {
        cat.x = Math.floor((cat.x + CAT_W) / TILE) * TILE - CAT_W - 0.001;
      } else {
        cat.x = Math.ceil(cat.x / TILE) * TILE + 0.001;
      }
      return true;
    }
  } else {
    cat.y += delta;
    if (rectHitsWall(cat.x, cat.y, CAT_W, CAT_H)) {
      if (delta > 0) {
        cat.y = Math.floor((cat.y + CAT_H) / TILE) * TILE - CAT_H - 0.001;
      } else {
        cat.y = Math.ceil(cat.y / TILE) * TILE + 0.001;
      }
      return true;
    }
  }
  return false;
}

/** Grid step from cat hitbox center: walkable if not a wall cell. */
function catNeighborWalkable(dc, dr) {
  const cx = cat.x + CAT_W / 2;
  const cy = cat.y + CAT_H / 2;
  const c = Math.floor(cx / TILE) + dc;
  const r = Math.floor(cy / TILE) + dr;
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return grid[r][c] !== WALL;
}

/**
 * After a wall hit: pick a legal cardinal (not into the wall we hit).
 * Prefers **not** doing an immediate 180° unless that’s the only option (stops edge ping-pong).
 */
function catPickNewDir(failDc, failDr, ovx, ovy) {
  const S = catSpeed;
  const cand = [];
  for (const [dc, dr, vx, vy] of [
    [-1, 0, -S, 0],
    [1, 0, S, 0],
    [0, -1, 0, -S],
    [0, 1, 0, S],
  ]) {
    if (dc === failDc && dr === failDr) continue;
    if (catNeighborWalkable(dc, dr)) cand.push({ dc, dr, vx, vy });
  }
  const odc = Math.abs(ovx) > 1e-6 ? Math.sign(ovx) : 0;
  const odr = Math.abs(ovy) > 1e-6 ? Math.sign(ovy) : 0;
  const notReverse = cand.filter((p) => !(p.dc === -odc && p.dr === -odr));
  const pool = notReverse.length > 0 ? notReverse : cand;
  catChooseRoamTarget();

  if (pool.length > 0) {
    const pick = catPickBestDirection(pool, odc, odr, false, pool.length > 1);
    if (pick.vx !== cat.vx || pick.vy !== cat.vy) {
      cat.vx = pick.vx;
      cat.vy = pick.vy;
      cat.travelSinceDecisionPx = 0;
    }
  } else {
    cat.vx = -failDc * S;
    cat.vy = -failDr * S;
    cat.travelSinceDecisionPx = 0;
  }
  catSpendRoamChoice();
  catSetBranchCooldown();
}

function moveWithWallCollision(axis, delta) {
  const ix = playerHitInsetX();
  const iy = playerHitInsetY();
  if (delta === 0) return;
  if (axis === "x") {
    player.x += delta;
    let hl = playerHitLeft();
    if (rectHitsWall(hl, playerHitTop(), PLAYER_HIT_W, PLAYER_HIT_H)) {
      if (delta > 0) {
        const hlNew = Math.floor((hl + PLAYER_HIT_W) / TILE) * TILE - PLAYER_HIT_W - 0.001;
        player.x = hlNew - ix;
      } else {
        const hlNew = Math.ceil(hl / TILE) * TILE + 0.001;
        player.x = hlNew - ix;
      }
    }
  } else {
    player.y += delta;
    let ht = playerHitTop();
    if (rectHitsWall(playerHitLeft(), ht, PLAYER_HIT_W, PLAYER_HIT_H)) {
      if (delta > 0) {
        const htNew = Math.floor((ht + PLAYER_HIT_H) / TILE) * TILE - PLAYER_HIT_H - 0.001;
        player.y = htNew - iy;
      } else {
        const htNew = Math.ceil(ht / TILE) * TILE + 0.001;
        player.y = htNew - iy;
      }
    }
  }
}

function dirKeyHeld(d) {
  if (d === "up") return keys.ArrowUp;
  if (d === "down") return keys.ArrowDown;
  if (d === "left") return keys.ArrowLeft;
  if (d === "right") return keys.ArrowRight;
  return false;
}

function neighborWalkable(dir) {
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  let c = Math.floor(cx / TILE);
  let r = Math.floor(cy / TILE);
  if (dir === "up") r -= 1;
  else if (dir === "down") r += 1;
  else if (dir === "left") c -= 1;
  else if (dir === "right") c += 1;
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return grid[r][c] !== WALL;
}

/**
 * For 90° turns only: `neighborWalkable` from a single floored center often mis-classifies the
 * target cell when the player straddles a tile edge (center in row R while the opening is
 * associated with R+1). We sample the center and a point ahead along `fromD` and OR results.
 * Still cannot open a path through a wall.
 * Forward probe kept modest so a side opening isn’t considered “active” until you’re nearer the corner
 * (large offsets felt like you had to steer two tiles early).
 */
function neighborWalkableFor90Turn(fromD, toD) {
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  let ox = 0;
  let oy = 0;
  const probe = TILE * 0.15;
  if (fromD === "down") oy = probe;
  else if (fromD === "up") oy = -probe;
  else if (fromD === "right") ox = probe;
  else if (fromD === "left") ox = -probe;
  const samples = [
    { x: cx, y: cy },
    { x: cx + ox, y: cy + oy },
    { x: cx + ox * 0.5, y: cy + oy * 0.5 },
  ];
  const seen = new Set();
  for (const s of samples) {
    const c = Math.floor(s.x / TILE);
    const r = Math.floor(s.y / TILE);
    const id = `${c},${r}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let tc = c;
    let tr = r;
    if (toD === "up") tr--;
    else if (toD === "down") tr++;
    else if (toD === "left") tc--;
    else if (toD === "right") tc++;
    if (tc >= 0 && tr >= 0 && tc < COLS && tr < ROWS && grid[tr][tc] !== WALL) return true;
  }
  return false;
}

function isHorizontal(d) {
  return d === "left" || d === "right";
}

/** Perpendicular 90°: close enough to lane center (see `TURN_DEADZONE`); wall legality is separate. */
function isAlignedForTurn(fromD, toD) {
  if (fromD === toD) return true;
  if (isHorizontal(fromD) === isHorizontal(toD)) return true;

  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  if (toD === "up" || toD === "down") {
    const colMid = Math.floor(cx / TILE) * TILE + TILE / 2;
    return Math.abs(cx - colMid) <= TURN_DEADZONE;
  }
  const rowMid = Math.floor(cy / TILE) * TILE + TILE / 2;
  return Math.abs(cy - rowMid) <= TURN_DEADZONE;
}

/**
 * When a 90° turn is walk-legal and we’re within `TURN_PREDICTIVE_SNAP_MAX` of lane center on the
 * alignment axis, snap fully onto that center so `isAlignedForTurn` passes without grinding frames.
 * Reverts if the snap would overlap a wall.
 */
function predictiveSnapOntoLaneAxisIfClose(fromD, toD) {
  if (fromD === toD || isHorizontal(fromD) === isHorizontal(toD)) return;
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  const colMid = Math.floor(cx / TILE) * TILE + TILE / 2;
  const rowMid = Math.floor(cy / TILE) * TILE + TILE / 2;
  let snapX = false;
  let snapY = false;
  if (toD === "up" || toD === "down") {
    const dist = Math.abs(cx - colMid);
    if (dist <= TURN_PREDICTIVE_SNAP_MAX) snapX = true;
  } else {
    const dist = Math.abs(cy - rowMid);
    if (dist <= TURN_PREDICTIVE_SNAP_MAX) snapY = true;
  }
  if (!snapX && !snapY) return;
  const ox = player.x;
  const oy = player.y;
  if (snapX) player.x = colMid - PLAYER_W / 2;
  if (snapY) player.y = rowMid - PLAYER_H / 2;
  if (rectHitsPlayerWall()) {
    player.x = ox;
    player.y = oy;
  }
}

/**
 * After a committed 90°, gently pull onto the corridor center for the new axis; full snap if blend clips.
 * Reverts if even full snap would overlap a wall.
 */
function snapPlayerAxisAfterTurnCommit(fromD, toD) {
  if (fromD === toD) return;
  if (isHorizontal(fromD) === isHorizontal(toD)) return;
  const ox = player.x;
  const oy = player.y;
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  const b = TURN_SNAP_BLEND;
  if (toD === "left" || toD === "right") {
    const rowMid = Math.floor(cy / TILE) * TILE + TILE / 2;
    const ty = rowMid - PLAYER_H / 2;
    player.y = oy + (ty - oy) * b;
  } else {
    const colMid = Math.floor(cx / TILE) * TILE + TILE / 2;
    const tx = colMid - PLAYER_W / 2;
    player.x = ox + (tx - ox) * b;
  }
  if (rectHitsPlayerWall()) {
    player.x = ox;
    player.y = oy;
    if (toD === "left" || toD === "right") {
      const rowMid = Math.floor(cy / TILE) * TILE + TILE / 2;
      player.y = rowMid - PLAYER_H / 2;
    } else {
      const colMid = Math.floor(cx / TILE) * TILE + TILE / 2;
      player.x = colMid - PLAYER_W / 2;
    }
    if (rectHitsPlayerWall()) {
      player.x = ox;
      player.y = oy;
    }
  }
}

/**
 * Drops `requestedDirection` only after max linger (never before REQUESTED_DIRECTION_MIN_MS from last keydown).
 */
function tickRequestedDirectionExpiry() {
  const now = performance.now();
  if (!requestedDirection) {
    requestedExpireAt = 0;
    return;
  }
  if (now < requestedLastKeydownAt + REQUESTED_DIRECTION_MIN_MS) return;
  if (now >= requestedExpireAt) {
    requestedDirection = null;
    requestedExpireAt = 0;
  }
}

/**
 * Pac-Man rule: resolve `requestedDirection` → `currentDirection` before integrating velocity each substep.
 * Clears request when executed; walls still enforced via neighbor checks.
 */
function tryExecuteRequestedTurn() {
  if (!requestedDirection) {
    if (DEBUG_PLAYER_TURNS) lastTurnDebugReject = "no requestedDirection";
    return;
  }
  if (requestedDirection === currentDirection) {
    if (DEBUG_PLAYER_TURNS) lastTurnDebugReject = "requested === current";
    return;
  }
  const perp90 = isHorizontal(currentDirection) !== isHorizontal(requestedDirection);
  const walkOk = perp90
    ? neighborWalkableFor90Turn(currentDirection, requestedDirection)
    : neighborWalkable(requestedDirection);
  if (!walkOk) {
    if (DEBUG_PLAYER_TURNS) lastTurnDebugReject = perp90 ? "wall (90° probe)" : "wall";
    return;
  }
  if (perp90) {
    predictiveSnapOntoLaneAxisIfClose(currentDirection, requestedDirection);
  }
  if (!isAlignedForTurn(currentDirection, requestedDirection)) {
    if (DEBUG_PLAYER_TURNS) lastTurnDebugReject = "off lane axis";
    return;
  }
  if (DEBUG_PLAYER_TURNS) lastTurnDebugReject = "commit ✓";
  const prev = currentDirection;
  currentDirection = requestedDirection;
  snapPlayerAxisAfterTurnCommit(prev, currentDirection);
  requestedDirection = null;
  requestedExpireAt = 0;
}

/**
 * Integrates player motion in substeps. Order: requested turn → lane assist → turn again → velocity along current → move.
 */
function updatePlayerPhysics(dt) {
  const maxStepSec = PLAYER_PHYS_MAX_PX / PLAYER_SPEED;
  let remaining = dt;
  while (remaining > 1e-10) {
    const sub = remaining > maxStepSec ? maxStepSec : remaining;
    tryExecuteRequestedTurn();
    applyLaneAssist(sub);
    tryExecuteRequestedTurn();
    applyVelocityFromCurrentDirection();
    applyLaneAssist(sub);
    const sdx = player.vx * sub;
    const sdy = player.vy * sub;
    if (Math.abs(sdx) >= Math.abs(sdy)) {
      moveWithWallCollision("x", sdx);
      moveWithWallCollision("y", sdy);
    } else {
      moveWithWallCollision("y", sdy);
      moveWithWallCollision("x", sdx);
    }
    tryExecuteRequestedTurn();
    applyLaneAssist(sub);
    tryExecuteRequestedTurn();
    remaining -= sub;
  }
}

/**
 * Motion follows `currentDirection` while that key is held, or coast forward with a perpendicular
 * queued `requestedDirection` (Pac-style) — the requested arrow does **not** need to stay held.
 */
function applyVelocityFromCurrentDirection() {
  const anyKey = keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
  if (!anyKey) {
    player.vx = 0;
    player.vy = 0;
    return;
  }
  const hasCurrentKey = dirKeyHeld(currentDirection);
  const hasPerpRequest =
    Boolean(requestedDirection) &&
    currentDirection !== requestedDirection &&
    isHorizontal(currentDirection) !== isHorizontal(requestedDirection);
  const canCoastToRequested = hasPerpRequest && neighborWalkable(currentDirection);
  if (!hasCurrentKey && !canCoastToRequested) {
    player.vx = 0;
    player.vy = 0;
    return;
  }

  if (currentDirection === "up") {
    player.vx = 0;
    player.vy = -PLAYER_SPEED;
  } else if (currentDirection === "down") {
    player.vx = 0;
    player.vy = PLAYER_SPEED;
  } else if (currentDirection === "left") {
    player.facingDirection = "left";
    player.vx = -PLAYER_SPEED;
    player.vy = 0;
  } else {
    player.facingDirection = "right";
    player.vx = PLAYER_SPEED;
    player.vy = 0;
  }
}

/** Actual movement direction (already committed). */
let currentDirection = "right";
/**
 * Last arrow pressed — queued turn target. Updated on every arrow keydown; expires only after REQUESTED_DIRECTION_MAX_MS
 * from that keydown (and not before REQUESTED_DIRECTION_MIN_MS), or when executed, blur, or `clearInputState()`.
 * @type {'up'|'down'|'left'|'right'|null}
 */
let requestedDirection = null;
/** `performance.now()` of last arrow keydown (for min linger). */
let requestedLastKeydownAt = 0;
/** Absolute expiry time for `requestedDirection` (`performance.now()`). */
let requestedExpireAt = 0;
/** Last `tryExecuteRequestedTurn` outcome when `DEBUG_PLAYER_TURNS` is on. */
let lastTurnDebugReject = "";

/**
 * When moving vertically, nudge X toward column center (and vice versa).
 * Makes 1-tile gaps easy without clipping walls.
 */
function applyLaneAssist(dt) {
  const perpBuffer =
    requestedDirection &&
    ((isHorizontal(currentDirection) && !isHorizontal(requestedDirection)) ||
      (!isHorizontal(currentDirection) && isHorizontal(requestedDirection)));

  let maxStep = LANE_ASSIST_SPEED * dt;
  if (perpBuffer) maxStep *= LANE_ASSIST_BOOST;
  if (perpBuffer && requestedDirection && !isAlignedForTurn(currentDirection, requestedDirection)) {
    maxStep *= LANE_ASSIST_URGENT;
  }

  let snapEps = SNAP_EPS;
  if (perpBuffer) snapEps *= SNAP_EPS_BUFFER;

  const wantVKey = keys.ArrowUp || keys.ArrowDown;
  const wantHKey = keys.ArrowLeft || keys.ArrowRight;
  const wantVBuf = requestedDirection === "up" || requestedDirection === "down";
  const wantHBuf = requestedDirection === "left" || requestedDirection === "right";
  const wantV = wantVKey || wantVBuf;
  const wantH = wantHKey || wantHBuf;

  const nudgeX =
    Math.abs(player.vy) > 0.01 ||
    (wantV && !wantH) ||
    (wantV && wantH && isHorizontal(currentDirection));
  const nudgeY =
    Math.abs(player.vx) > 0.01 ||
    (wantH && !wantV) ||
    (wantV && wantH && !isHorizontal(currentDirection));

  if (nudgeX) {
    const targetX = Math.floor((player.x + PLAYER_W / 2) / TILE) * TILE + (TILE - PLAYER_W) / 2;
    let dx = targetX - player.x;
    if (Math.abs(dx) < snapEps) player.x = targetX;
    else {
      dx = Math.sign(dx) * Math.min(Math.abs(dx), maxStep);
      const ox = player.x;
      player.x += dx;
      if (rectHitsPlayerWall()) player.x = ox;
    }
  }

  if (nudgeY) {
    const targetY = Math.floor((player.y + PLAYER_H / 2) / TILE) * TILE + (TILE - PLAYER_H) / 2;
    let dy = targetY - player.y;
    if (Math.abs(dy) < snapEps) player.y = targetY;
    else {
      dy = Math.sign(dy) * Math.min(Math.abs(dy), maxStep);
      const oy = player.y;
      player.y += dy;
      if (rectHitsPlayerWall()) player.y = oy;
    }
  }
}

function spawnPickupBurst(col, row, snackId) {
  const x = col * TILE + TILE / 2;
  const y = row * TILE + TILE / 2;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.35;
    const sp = 69 + Math.random() * 113;
    pickupParticles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: PICKUP_PARTICLE_LIFE,
      snackId,
    });
  }
  player.pickupPop = Math.min(1, player.pickupPop + 0.85);
}

function updatePickupJuice(dt) {
  if (player.pickupPop > 0) {
    player.pickupPop = Math.max(0, player.pickupPop - PICKUP_POP_DECAY * dt);
  }
  for (let i = pickupParticles.length - 1; i >= 0; i--) {
    const p = pickupParticles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 525 * dt;
    if (p.life <= 0) pickupParticles.splice(i, 1);
  }
}

function spawnCelebrationSparkle(x, y, vx, vy) {
  if (celebrationSparkles.length >= STREAK_CELEBRATION.maxSparkles) return;
  const palette = [
    { core: "rgba(255, 255, 255, 0.98)", glow: "rgba(255, 222, 240, 0.42)" },
    { core: "rgba(255, 248, 205, 0.96)", glow: "rgba(255, 234, 168, 0.34)" },
    { core: "rgba(233, 244, 255, 0.96)", glow: "rgba(187, 228, 255, 0.34)" },
  ];
  const tint = palette[Math.floor(Math.random() * palette.length)];
  const [lifeLo, lifeHi] = STREAK_CELEBRATION.sparkleLife;
  const maxLife = lifeLo + Math.random() * (lifeHi - lifeLo);
  celebrationSparkles.push({
    x,
    y,
    vx,
    vy,
    life: maxLife,
    maxLife,
    size: 4 + Math.random() * 4.5,
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 1.8,
    core: tint.core,
    glow: tint.glow,
  });
}

function spawnCelebrationBurst(x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.45;
    const sp = 16 + Math.random() * 26;
    spawnCelebrationSparkle(
      x + Math.cos(a) * (10 + Math.random() * 14),
      y + Math.sin(a) * (10 + Math.random() * 14),
      Math.cos(a) * sp,
      Math.sin(a) * sp - 6
    );
  }
}

function spawnAmbientCelebrationSparkle() {
  const gutter = 20;
  const topBand = FRAME_PAD + 64;
  let x = gutter + Math.random() * (canvas.width - gutter * 2);
  let y = gutter + Math.random() * topBand;

  const laneRoll = Math.random();
  if (laneRoll < 0.2) x = gutter + Math.random() * 90;
  else if (laneRoll > 0.8) x = canvas.width - gutter - Math.random() * 90;

  if (Math.random() < 0.28) {
    y = FRAME_PAD + 18 + Math.random() * (WORLD_H - 36);
  }

  spawnCelebrationSparkle(x, y, (Math.random() - 0.5) * 10, -12 - Math.random() * 16);
}

function beginCelebrationMode(screenX, screenY) {
  celebrationUntil = Math.max(performance.now() + STREAK_CELEBRATION.durationMs, celebrationUntil);
  celebrationLastStreak = snackStreak;
  celebrationSpawnCarry = 0;
  spawnCelebrationBurst(screenX, screenY, STREAK_CELEBRATION.introBurst);
  for (let i = 0; i < 4; i++) spawnAmbientCelebrationSparkle();
  applyCelebrationUi();
}

function updateCelebrationJuice(dt) {
  if (celebrationUntil > 0 && !celebrationActive()) {
    celebrationUntil = 0;
    applyCelebrationUi();
  }

  for (let i = celebrationSparkles.length - 1; i >= 0; i--) {
    const s = celebrationSparkles[i];
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 12 * dt;
    s.rot += s.spin * dt;
    if (s.life <= 0) celebrationSparkles.splice(i, 1);
  }

  if (!celebrationVisualsActive()) return;

  celebrationSpawnCarry += dt * STREAK_CELEBRATION.sparklesPerSec;
  while (
    celebrationSpawnCarry >= 1 &&
    celebrationSparkles.length < STREAK_CELEBRATION.maxSparkles
  ) {
    celebrationSpawnCarry -= 1;
    spawnAmbientCelebrationSparkle();
  }
}

function update(dt) {
  updateCelebrationJuice(dt);

  if (mode === "level-complete") {
    updatePickupJuice(dt);
    if (performance.now() >= levelTransitionUntil) advanceToNextLevel();
    return;
  }

  if (mode !== "playing") {
    updatePickupJuice(dt);
    return;
  }

  if (respawnMsgActive && performance.now() >= enemyFreezeUntil) {
    respawnMsgActive = false;
    elStatus.textContent = "";
  }

  updatePlayerPhysics(dt);

  tickRequestedDirectionExpiry();

  collectSnacks();
  updatePickupJuice(dt);

  if (snacks.length === 0) {
    updateHud();
    beginLevelComplete();
    return;
  }

  if (updateCats(dt)) {
    loseLife();
    return;
  }

  updateHud();
}

function collectSnacks() {
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  const col0 = Math.floor(cx / TILE);
  const row0 = Math.floor(cy / TILE);

  let best = null;
  let bestD = Infinity;

  for (const [dc, dr] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const c = col0 + dc;
    const r = row0 + dr;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
    if (grid[r][c] !== SNACK) continue;
    const tcx = c * TILE + TILE / 2;
    const tcy = r * TILE + TILE / 2;
    const d = Math.hypot(cx - tcx, cy - tcy);
    if (d < bestD && d < PICKUP_RADIUS) {
      bestD = d;
      best = { c, r };
    }
  }

  if (!best) return;
  const { c: col, r: row } = best;

  let snackId = SNACK_SET[0].id;
  for (let i = snacks.length - 1; i >= 0; i--) {
    if (snacks[i].col === col && snacks[i].row === row) {
      snackId = snacks[i].snackId;
      snacks.splice(i, 1);
      break;
    }
  }

  grid[row][col] = EMPTY;
  spawnPickupBurst(col, row, snackId);
  playEatSound();
  snackStreak += 1;

  if (snackStreak >= nextCelebrationStreak) {
    nextCelebrationStreak += STREAK_CELEBRATION.snacksPerParty;
    beginCelebrationMode(FRAME_PAD + col * TILE + TILE / 2, FRAME_PAD + row * TILE + TILE / 2);
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawCellWalkable(c, r) {
  return grid[r][c] !== WALL;
}

/** Representative mid-tone of pink path stones (see `drawGardenPath` tints). */
const PATH_STONE_REF = "#fce3ee";
/** Typical “body” pink on a path tile (darker than highlights). */
const PATH_STONE_BODY = "#f0c2d8";
/** Solid fill for walkable “lawn” behind the maze (path tiles use their own palette). */
const LAWN_MAIN = "#ffd9e7";

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function tintPinkHex(hex, dr, dg, db) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + dr, g + dg, b + db);
}

function drawGardenLawn() {
  const lawn = LAWN_MAIN;
  const lawnHi = tintPinkHex(lawn, 6, 5, 5);
  const g = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
  g.addColorStop(0, lawnHi);
  g.addColorStop(0.5, lawn);
  g.addColorStop(1, lawnHi);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const h = (c * 17 + r * 31) % 100;
      if (h > 78) continue;
      const x = c * TILE + ((r * 7) % 9);
      const y = r * TILE + ((c * 5) % 11);
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = "rgba(255, 218, 210, 0.1)";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((c * 3 + r * 5) % 17 !== 0) continue;
      ctx.fillRect(c * TILE + 10, r * TILE + 6, 2, 2);
    }
  }
}

/** Pastel pink path “stones” — inset rounds keep sky/lawn gutters at junctions. */
function drawGardenPath() {
  const pathPad = 5;
  const pathRad = 11;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!drawCellWalkable(c, r)) continue;
      const x = c * TILE + pathPad;
      const y = r * TILE + pathPad;
      const w = TILE - pathPad * 2;
      const h = TILE - pathPad * 2;
      const tint = (c + r * 3) % 5;
      const pg = ctx.createLinearGradient(x, y, x + w, y + h);
      if (tint === 0) {
        pg.addColorStop(0, "#fff0f5");
        pg.addColorStop(0.5, PATH_STONE_REF);
        pg.addColorStop(1, "#e8b4cc");
      } else if (tint === 1) {
        pg.addColorStop(0, "#fff3f8");
        pg.addColorStop(0.55, "#f6d4e4");
        pg.addColorStop(1, "#e2a8c2");
      } else if (tint === 2) {
        pg.addColorStop(0, "#fffafc");
        pg.addColorStop(0.5, "#f8dfec");
        pg.addColorStop(1, "#deb0ca");
      } else if (tint === 3) {
        pg.addColorStop(0, "#fef5f9");
        pg.addColorStop(0.55, "#f8dce8");
        pg.addColorStop(1, "#e0aac4");
      } else {
        pg.addColorStop(0, "#fff6fa");
        pg.addColorStop(0.5, "#fadce8");
        pg.addColorStop(1, "#e6b2ce");
      }
      ctx.fillStyle = pg;
      roundRectPath(ctx, x, y, w, h, pathRad);
      ctx.fill();

      ctx.strokeStyle = "rgba(210, 130, 165, 0.38)";
      ctx.lineWidth = 1.25;
      roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, pathRad - 1);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.33, y + h * 0.24, w * 0.16, h * 0.08, -0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Procedural hedge (fallback while bush PNG loads or if load fails). */
function drawGardenHedgeCellFallback(c, r) {
  const x = c * TILE;
  const y = r * TILE;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;

  const openN = r > 0 && drawCellWalkable(c, r - 1);
  const openS = r < ROWS - 1 && drawCellWalkable(c, r + 1);
  const openW = c > 0 && drawCellWalkable(c - 1, r);
  const openE = c < COLS - 1 && drawCellWalkable(c + 1, r);

  const bush = (bx, by, rad, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(bx, by, rad, 0, Math.PI * 2);
    ctx.fill();
  };

  const yPull = openN ? 5 : 0;
  bush(cx - TILE * 0.22, cy + 4 + yPull * 0.2, TILE * 0.28, "#5abe84");
  bush(cx + TILE * 0.24, cy + 2 + yPull * 0.15, TILE * 0.26, "#4fb079");
  bush(cx, cy - 2 + yPull, TILE * 0.3, "#6bc896");
  bush(cx - TILE * 0.08, cy + TILE * 0.12 + yPull * 0.1, TILE * 0.22, "#4fa870");
  bush(cx + TILE * 0.1, cy + TILE * 0.1 + yPull * 0.1, TILE * 0.2, "#56b67a");

  ctx.strokeStyle = "rgba(80, 140, 100, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx - TILE * 0.18, cy + 2, TILE * 0.18, 0.2 * Math.PI, 1.1 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + TILE * 0.2, cy, TILE * 0.16, 0.4 * Math.PI, 1.3 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1;
  if (!openN) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 8);
    ctx.quadraticCurveTo(cx, y + 4, x + TILE - 6, y + 8);
    ctx.stroke();
  }
  if (!openW) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 10);
    ctx.quadraticCurveTo(x + 3, cy, x + 6, y + TILE - 8);
    ctx.stroke();
  }
  if (!openE) {
    ctx.beginPath();
    ctx.moveTo(x + TILE - 6, y + 10);
    ctx.quadraticCurveTo(x + TILE - 3, cy, x + TILE - 6, y + TILE - 8);
    ctx.stroke();
  }
  if (!openS) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + TILE - 8);
    ctx.quadraticCurveTo(cx, y + TILE - 4, x + TILE - 6, y + TILE - 8);
    ctx.stroke();
  }
}

/** One wall tile: PNG bush when loaded; otherwise procedural fallback. */
function drawGardenHedgeCell(c, r) {
  const x = c * TILE;
  const y = r * TILE;
  if (imageLoaded(bushWallImage)) {
    const pad = BUSH_WALL_TILE_PADDING;
    const maxW = TILE - pad * 2;
    const maxH = TILE - pad * 2;
    const iw = bushWallImage.naturalWidth;
    const ih = bushWallImage.naturalHeight;
    const scale = Math.min(maxW / iw, maxH / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const dx = x + (TILE - drawW) / 2;
    const dy = y + (TILE - drawH) / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bushWallImage, 0, 0, iw, ih, dx, dy, drawW, drawH);
    ctx.restore();
    return;
  }
  drawGardenHedgeCellFallback(c, r);
}

function drawGardenHedges() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== WALL) continue;
      drawGardenHedgeCell(c, r);
    }
  }
}

/** Sparse pastel flowers on EMPTY tiles only — keeps snacks and corridors clear. */
function drawGardenAccents() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== EMPTY) continue;
      const h = (c * 47 + r * 83) % 100;
      if (h > 5) continue;

      const ox = ((c * 13 + r * 7) % 10) - 5;
      const oy = ((r * 11 + c * 5) % 10) - 5;
      const px = c * TILE + TILE / 2 + ox;
      const py = r * TILE + TILE / 2 + oy + 4;

      ctx.strokeStyle = "rgba(120, 180, 140, 0.4)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(px, py + 2);
      ctx.quadraticCurveTo(px + 2, py - 4, px + 1, py - 7);
      ctx.stroke();

      const petal = (dx, dy, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px + dx, py - 6 + dy, 2, 0, Math.PI * 2);
        ctx.fill();
      };

      const kind = (c + r * 2) % 4;
      if (kind === 0) {
        petal(0, 0, "#ffb8dc");
        petal(-3.2, 0.8, "#ffc8e6");
        petal(3.2, 0.8, "#ffa8d4");
        ctx.fillStyle = "#fff4b8";
        ctx.beginPath();
        ctx.arc(px, py - 6, 1.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 1) {
        petal(0, 0, "#c9e8ff");
        petal(-2.8, 0.6, "#b8dff9");
        petal(2.8, 0.6, "#a8d6ff");
        ctx.fillStyle = "#fffde8";
        ctx.beginPath();
        ctx.arc(px, py - 5.5, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 2) {
        petal(0, 0, "#e8ffc8");
        petal(-3, 0.5, "#dff5b8");
        petal(3, 0.5, "#d4eea8");
        petal(0, 2.8, "#c8e898");
      } else {
        ctx.fillStyle = "#d4f5e8";
        for (let i = 0; i < 3; i++) {
          const a = (Math.PI * 2 * i) / 3;
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * 2.4, py - 4 + Math.sin(a) * 2.4, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

/** Full-canvas mat behind the translated playfield (padding gutter). */
function drawFrameBackdrop() {
  const cw = canvas.width;
  const ch = canvas.height;
  const hi = tintPinkHex(LAWN_MAIN, 8, 6, 4);
  const lo = tintPinkHex(LAWN_MAIN, -5, -3, 2);
  const g = ctx.createLinearGradient(0, 0, cw, ch);
  g.addColorStop(0, hi);
  g.addColorStop(0.48, LAWN_MAIN);
  g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
}

/**
 * One soft rounded frame in the padding gutter (screen coords) — supports the board without busy rings.
 */
function drawGardenBorder() {
  const wx = FRAME_PAD;
  const wy = FRAME_PAD;
  const ww = WORLD_W;
  const wh = WORLD_H;
  const d = 10;
  const x = wx - d;
  const y = wy - d;
  const w = ww + d * 2;
  const h = wh + d * 2;
  const rad = 16;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, rad);
  ctx.shadowColor = "rgba(170, 110, 145, 0.18)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  ctx.strokeStyle = "rgba(252, 232, 242, 0.82)";
  ctx.lineWidth = 2.25;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.restore();
}

function drawMaze() {
  drawGardenLawn();
  drawGardenPath();
  drawGardenHedges();
  drawGardenAccents();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const iconPx = TILE * 0.78;
  for (const s of snacks) {
    const x = s.col * TILE + TILE / 2;
    const y = s.row * TILE + TILE / 2;
    const rGlow = TILE * 0.46;

    const rg = ctx.createRadialGradient(x, y, 1, x, y, rGlow);
    rg.addColorStop(0, s.glow);
    rg.addColorStop(0.62, "rgba(255, 248, 252, 0.18)");
    rg.addColorStop(1, "rgba(255, 240, 248, 0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, rGlow, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = "rgba(82, 54, 77, 0.28)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.25;
    drawSnackSprite(s.snackId, x, y, iconPx);
    ctx.restore();
  }
}

function drawPickupParticles() {
  for (const p of pickupParticles) {
    const t = p.life / PICKUP_PARTICLE_LIFE;
    const a = Math.max(0, t);
    drawSnackSprite(p.snackId, p.x, p.y, TILE * (0.32 + 0.08 * a), a);
  }
}

function drawCorgiFallback() {
  const px = player.x;
  const py = player.y;
  const pw = PLAYER_W;
  const ph = PLAYER_H;
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const pop = player.pickupPop;
  const s = 1 + pop * 0.14;
  const moving = Math.abs(player.vx) + Math.abs(player.vy) > 10;
  const bob = Math.sin(performance.now() / 95) * (moving ? 1.35 : 0.45);

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.scale((player.facingDirection === "left" ? -1 : 1) * s * CORGI_DRAW_SCALE, s * CORGI_DRAW_SCALE);

  const bodyW = pw * 0.95;
  const bodyH = ph * 0.58;
  const fluff = pw * 0.13;

  const haloR = Math.max(pw, ph) * 0.95;
  const hg = ctx.createRadialGradient(0, 3, 2, 0, 2, haloR);
  hg.addColorStop(0, "rgba(255, 250, 238, 0.42)");
  hg.addColorStop(0.42, "rgba(255, 225, 205, 0.16)");
  hg.addColorStop(1, "rgba(255, 200, 215, 0)");
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 2, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Ground shadow (soft on pastel path)
  ctx.fillStyle = "rgba(105, 78, 108, 0.2)";
  ctx.beginPath();
  ctx.ellipse(0, bodyH * 0.55, bodyW * 0.48, bodyH * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const bx = -bodyW / 2;
  const by = -bodyH / 4;
  const br = 11;
  ctx.fillStyle = "#f0a66e";
  ctx.shadowColor = "rgba(255, 238, 220, 0.75)";
  ctx.shadowBlur = 14;
  roundRectPath(ctx, bx, by, bodyW, bodyH, br);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
  ctx.lineWidth = 1.35;
  roundRectPath(ctx, bx - 0.4, by - 0.35, bodyW + 0.8, bodyH + 0.7, br + 1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(110, 68, 38, 0.26)";
  ctx.lineWidth = 1.85;
  roundRectPath(ctx, bx, by, bodyW, bodyH, br);
  ctx.stroke();

  // Chest + neck fluff
  ctx.fillStyle = "#fff8f0";
  ctx.beginPath();
  ctx.ellipse(0, bodyH * 0.06, bodyW * 0.26, bodyH * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cheek blush
  ctx.fillStyle = "rgba(255, 150, 160, 0.45)";
  ctx.beginPath();
  ctx.ellipse(-bodyW * 0.12, bodyH * 0.02, 4.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears — soft rounded triangles (side-profile read)
  ctx.fillStyle = "#d97d4a";
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.34, -bodyH * 0.3);
  ctx.quadraticCurveTo(-bodyW * 0.4, -bodyH * 0.5, -bodyW * 0.2, -bodyH * 0.68);
  ctx.quadraticCurveTo(-bodyW * 0.06, -bodyH * 0.52, -bodyW * 0.08, -bodyH * 0.28);
  ctx.quadraticCurveTo(-bodyW * 0.22, -bodyH * 0.26, -bodyW * 0.34, -bodyH * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bodyW * 0.34, -bodyH * 0.3);
  ctx.quadraticCurveTo(bodyW * 0.4, -bodyH * 0.5, bodyW * 0.2, -bodyH * 0.68);
  ctx.quadraticCurveTo(bodyW * 0.06, -bodyH * 0.52, bodyW * 0.08, -bodyH * 0.28);
  ctx.quadraticCurveTo(bodyW * 0.22, -bodyH * 0.26, bodyW * 0.34, -bodyH * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 220, 210, 0.8)";
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.28, -bodyH * 0.32);
  ctx.quadraticCurveTo(-bodyW * 0.32, -bodyH * 0.48, -bodyW * 0.2, -bodyH * 0.58);
  ctx.quadraticCurveTo(-bodyW * 0.12, -bodyH * 0.46, -bodyW * 0.14, -bodyH * 0.3);
  ctx.quadraticCurveTo(-bodyW * 0.22, -bodyH * 0.28, -bodyW * 0.28, -bodyH * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bodyW * 0.28, -bodyH * 0.32);
  ctx.quadraticCurveTo(bodyW * 0.32, -bodyH * 0.48, bodyW * 0.2, -bodyH * 0.58);
  ctx.quadraticCurveTo(bodyW * 0.12, -bodyH * 0.46, bodyW * 0.14, -bodyH * 0.3);
  ctx.quadraticCurveTo(bodyW * 0.22, -bodyH * 0.28, bodyW * 0.28, -bodyH * 0.32);
  ctx.closePath();
  ctx.fill();

  // Snout
  ctx.fillStyle = "#ffd9bc";
  ctx.beginPath();
  ctx.ellipse(bodyW * 0.39, 0, bodyW * 0.21, bodyH * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tongue — side view, slight flop forward (lick)
  ctx.fillStyle = "#ff7d92";
  ctx.strokeStyle = "rgba(170, 50, 80, 0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bodyW * 0.3, bodyH * 0.05);
  ctx.quadraticCurveTo(bodyW * 0.38, bodyH * 0.2, bodyW * 0.54, bodyH * 0.17);
  ctx.quadraticCurveTo(bodyW * 0.62, bodyH * 0.1, bodyW * 0.52, bodyH * 0.02);
  ctx.quadraticCurveTo(bodyW * 0.42, -bodyH * 0.02, bodyW * 0.3, bodyH * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 200, 210, 0.55)";
  ctx.beginPath();
  ctx.ellipse(bodyW * 0.44, bodyH * 0.09, bodyW * 0.07, bodyH * 0.06, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Nose + tiny smile
  ctx.fillStyle = "#2b2230";
  ctx.beginPath();
  ctx.ellipse(bodyW * 0.54, 0, 2.4, 2.025, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 34, 48, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(bodyW * 0.42, 4, 5, 0.15 * Math.PI, 0.55 * Math.PI);
  ctx.stroke();

  // Eye (~3/4 of prior size for a softer read)
  ctx.fillStyle = "#1a1a22";
  ctx.beginPath();
  ctx.arc(bodyW * 0.1, -bodyH * 0.14, 3.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(bodyW * 0.12, -bodyH * 0.16, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(bodyW * 0.09, -bodyH * 0.12, 0.83, 0, Math.PI * 2);
  ctx.fill();

  // Stub legs
  ctx.fillStyle = "#e8955c";
  const legY = bodyH * 0.4;
  ctx.fillRect(-bodyW * 0.36, legY, pw * 0.15, ph * 0.2);
  ctx.fillRect(bodyW * 0.22, legY, pw * 0.15, ph * 0.2);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(-bodyW * 0.32, legY + ph * 0.16, pw * 0.08, 2);
  ctx.fillRect(bodyW * 0.26, legY + ph * 0.16, pw * 0.08, 2);

  // Tail fluff
  ctx.fillStyle = "#ffd873";
  ctx.beginPath();
  ctx.arc(-bodyW * 0.56, -bodyH * 0.04, fluff, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function getPlayerSpriteImage() {
  return player.facingDirection === "left" ? playerSprites.left : playerSprites.right;
}

function getPlayerSpriteKey() {
  return player.facingDirection === "left" ? "left" : "right";
}

/** Shared: side-view kawaii sprite + quarter-turns for vertical motion (corgi + cat). */
function getSideViewSpriteRotation(direction, facingDirection) {
  if (direction === "up") {
    return facingDirection === "left" ? Math.PI / 2 : -Math.PI / 2;
  }
  if (direction === "down") {
    return facingDirection === "left" ? -Math.PI / 2 : Math.PI / 2;
  }
  return 0;
}

function getPlayerSpriteRotation(direction, facingDirection) {
  return getSideViewSpriteRotation(direction, facingDirection);
}

function drawPlayerSprite(image, cx, cy, scale, bob, rotation) {
  const maxDrawW = PLAYER_W * PLAYER_SPRITE_BOX_SCALE * scale;
  const maxDrawH = PLAYER_H * PLAYER_SPRITE_BOX_SCALE * scale;
  const imageW = image.naturalWidth || 1;
  const imageH = image.naturalHeight || 1;
  const fit = Math.min(maxDrawW / imageW, maxDrawH / imageH);
  const drawW = imageW * fit;
  const drawH = imageH * fit;

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.fillStyle = "rgba(105, 78, 108, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, drawH * 0.31, drawW * 0.27, drawH * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(rotation);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, -drawW / 2, -drawH / 2 + PLAYER_SPRITE_Y_OFFSET, drawW, drawH);
  ctx.restore();
}

function drawMissingPlayerSprite(cx, cy, scale, bob, spriteKey) {
  const size = Math.max(PLAYER_W, PLAYER_H) * 1.22 * scale;
  const half = size / 2;
  const status = playerSpriteStatus[spriteKey];

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.fillStyle = "rgba(255, 0, 200, 0.9)";
  ctx.fillRect(-half, -half, size, size);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-half * 0.7, -half * 0.7);
  ctx.lineTo(half * 0.7, half * 0.7);
  ctx.moveTo(half * 0.7, -half * 0.7);
  ctx.lineTo(-half * 0.7, half * 0.7);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 10px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(status === "error" ? "sprite error" : "sprite load", 0, half * 0.82);
  ctx.restore();
}

function drawCorgi() {
  const px = player.x;
  const py = player.y;
  const pw = PLAYER_W;
  const ph = PLAYER_H;
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const pop = player.pickupPop;
  const scale = 1 + pop * 0.14;
  const moving = Math.abs(player.vx) + Math.abs(player.vy) > 10;
  const bob = Math.sin(performance.now() / 95) * (moving ? 1.35 : 0.45);
  const spriteKey = getPlayerSpriteKey();
  const sprite = getPlayerSpriteImage();
  const rotation = getPlayerSpriteRotation(currentDirection, player.facingDirection);

  if (!imageLoaded(sprite)) {
    drawMissingPlayerSprite(cx, cy, scale, bob, spriteKey);
    return;
  }

  drawPlayerSprite(sprite, cx, cy, scale, bob, rotation);
}

function drawSafeTimeHint() {
  if (mode !== "playing" || !enemiesAreFrozen()) return;
  const msLeft = enemyFreezeUntil - performance.now();
  if (msLeft <= 0) return;
  const sec = Math.max(1, Math.ceil(msLeft / 1000));
  ctx.save();
  ctx.font = "600 16px system-ui, Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(110, 130, 165, 0.88)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 4;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const msg = `Safe time ~${sec}s`;
  ctx.strokeText(msg, WORLD_W - 12, 10);
  ctx.fillText(msg, WORLD_W - 12, 10);
  ctx.restore();
}

function drawCelebrationBackdropEffects() {
  if (!celebrationVisualsActive() && celebrationSparkles.length === 0) return;

  const now = performance.now();
  const pulse = 0.62 + 0.38 * Math.sin(now / 240);
  const activeMix = celebrationVisualsActive()
    ? Math.max(0, Math.min(1, (celebrationUntil - now) / STREAK_CELEBRATION.durationMs))
    : 0;

  ctx.save();

  if (activeMix > 0) {
    for (const [gx, gy, radius, inner, outer] of [
      [FRAME_PAD + 80, FRAME_PAD + 52, 180, `rgba(255, 222, 238, ${0.13 * pulse})`, "rgba(255, 222, 238, 0)"],
      [canvas.width - FRAME_PAD - 90, FRAME_PAD + 64, 170, `rgba(217, 241, 255, ${0.11 * pulse})`, "rgba(217, 241, 255, 0)"],
      [canvas.width / 2, FRAME_PAD + 20, 210, `rgba(255, 244, 198, ${0.08 * pulse})`, "rgba(255, 244, 198, 0)"],
    ]) {
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.lineCap = "round";
  for (const s of celebrationSparkles) {
    const t = Math.max(0, s.life / s.maxLife);
    const twinkle = 0.72 + 0.28 * Math.sin(now * 0.014 + s.rot * 3.5);
    const a = t * twinkle;
    const size = s.size * (0.8 + 0.2 * (1 - t));

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = a;
    ctx.shadowColor = s.glow;
    ctx.shadowBlur = 10;

    ctx.strokeStyle = s.core;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.stroke();

    ctx.globalAlpha = a * 0.72;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-size * 0.58, -size * 0.58);
    ctx.lineTo(size * 0.58, size * 0.58);
    ctx.moveTo(size * 0.58, -size * 0.58);
    ctx.lineTo(-size * 0.58, size * 0.58);
    ctx.stroke();

    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = s.core;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.2, size * 0.18), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawCelebrationHint() {
  if (!celebrationVisualsActive()) return;

  const remain = Math.max(0, celebrationUntil - performance.now());
  const progress = 1 - remain / STREAK_CELEBRATION.durationMs;
  const y = 12 + Math.sin(progress * Math.PI * 5) * 1.6;
  const w = 258;
  const h = 52;
  const x = (WORLD_W - w) / 2;

  ctx.save();
  const panel = ctx.createLinearGradient(x, y, x + w, y + h);
  panel.addColorStop(0, "rgba(255, 250, 252, 0.94)");
  panel.addColorStop(0.55, "rgba(255, 237, 246, 0.92)");
  panel.addColorStop(1, "rgba(241, 245, 255, 0.92)");
  ctx.fillStyle = panel;
  roundRectPath(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.strokeStyle = "rgba(237, 185, 210, 0.82)";
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, x, y, w, h, 20);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 18px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.globalAlpha = 0.9;
  ctx.fillText("✨", x + 28, y + h / 2);
  ctx.fillText("🐾", x + w - 28, y + h / 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#c56f98";
  ctx.font = "800 17px system-ui, Segoe UI, sans-serif";
  ctx.fillText(`${celebrationLastStreak} Snack Streak!`, x + w / 2, y + h / 2);
  ctx.restore();
}

function getWrappedTextBlock(text, maxWidth, lineHeight) {
  if (!text) {
    return { lines: [], height: 0 };
  }

  const lines = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }

  return {
    lines,
    height: lines.length * lineHeight,
  };
}

function drawCenteredWrappedText(lines, x, y, lineHeight) {
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
}

function drawOverlayBadge(cx, y, text, fillStyle, strokeStyle, textStyle) {
  ctx.save();
  ctx.font = "700 14px system-ui, Segoe UI, sans-serif";
  const padX = 16;
  const h = 32;
  const w = Math.max(156, ctx.measureText(text).width + padX * 2);
  const x = cx - w / 2;
  ctx.fillStyle = fillStyle;
  roundRectPath(ctx, x, y - h / 2, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, x, y - h / 2, w, h, 16);
  ctx.stroke();
  ctx.fillStyle = textStyle;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y);
  ctx.restore();
}

function drawOverlayActionPill(cx, y, text, fillStyle, strokeStyle, textStyle) {
  ctx.save();
  ctx.font = "700 15px system-ui, Segoe UI, sans-serif";
  const padX = 18;
  const h = 42;
  const w = Math.max(228, ctx.measureText(text).width + padX * 2);
  const x = cx - w / 2;
  ctx.fillStyle = fillStyle;
  roundRectPath(ctx, x, y - h / 2, w, h, 20);
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, x, y - h / 2, w, h, 20);
  ctx.stroke();
  ctx.fillStyle = textStyle;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y + 0.5);
  ctx.restore();
}

function getStageOverlayConfig() {
  const level = getCurrentLevel();
  const nextLevel = getNextLevel();

  if (mode === "start") {
    return {
      title: "Corgi Snack Attack",
      eyebrow: "Dreamy Arcade Snack Run",
      subtitle: `Collect every snack, dodge the cats, and clear all ${TOTAL_LEVELS} levels.`,
      detail: "Arrow keys move. R restarts a run any time.",
      action: "Press Space or tap to start",
      cardW: 548,
      cardH: 292,
      backdrop: "rgba(255, 248, 252, 0.6)",
      panelStops: ["rgba(255, 252, 254, 0.99)", "rgba(255, 239, 247, 0.98)", "rgba(239, 244, 255, 0.98)"],
      badgeFill: "rgba(255, 246, 250, 0.94)",
      badgeStroke: "rgba(234, 173, 204, 0.7)",
      badgeText: "#ca769c",
      titleColor: "#586383",
      bodyColor: "#8a7797",
      detailColor: "#b46e95",
      actionFill: "rgba(255, 255, 255, 0.92)",
      actionStroke: "rgba(236, 178, 208, 0.85)",
      actionText: "#c46b94",
      icons: ["cupcake", "pizza", "boba"],
      celebrate: false,
    };
  }

  if (mode === "level-complete") {
    return {
      title: "Level Complete",
      eyebrow: level.title,
      subtitle: `Next: ${nextLevel.title}`,
      detail: "Tiny victory lap. The next maze is loading now.",
      action: "Loading next level...",
      cardW: 500,
      cardH: 236,
      backdrop: "rgba(255, 248, 252, 0.56)",
      panelStops: ["rgba(255, 251, 253, 0.98)", "rgba(255, 238, 246, 0.98)", "rgba(244, 232, 255, 0.98)"],
      badgeFill: "rgba(255, 245, 249, 0.92)",
      badgeStroke: "rgba(230, 170, 205, 0.72)",
      badgeText: "#d176a1",
      titleColor: "#5f6687",
      bodyColor: "#8f789e",
      detailColor: "#b07295",
      actionFill: "rgba(255, 247, 251, 0.92)",
      actionStroke: "rgba(236, 184, 209, 0.8)",
      actionText: "#c06f97",
      icons: [SNACK_SET[(currentLevelIndex * 2) % SNACK_SET.length].id],
      celebrate: false,
    };
  }

  if (mode === "gameover") {
    return {
      title: "Game Over",
      eyebrow: `Reached ${level.title}`,
      subtitle: "The cats won this round, but the maze still believes in you.",
      detail: "Start fresh and chase an even cleaner run.",
      action: "Press Space, tap, or R to replay",
      cardW: 512,
      cardH: 256,
      backdrop: "rgba(249, 243, 250, 0.66)",
      panelStops: ["rgba(255, 250, 253, 0.98)", "rgba(248, 235, 245, 0.98)", "rgba(239, 233, 250, 0.98)"],
      badgeFill: "rgba(255, 245, 250, 0.92)",
      badgeStroke: "rgba(223, 177, 208, 0.7)",
      badgeText: "#bf739c",
      titleColor: "#66617f",
      bodyColor: "#8a7c99",
      detailColor: "#b16f93",
      actionFill: "rgba(255, 255, 255, 0.92)",
      actionStroke: "rgba(226, 182, 210, 0.84)",
      actionText: "#bc6e93",
      icons: ["♡"],
      celebrate: false,
    };
  }

  if (mode === "gamecomplete") {
    return {
      title: "You Win!",
      eyebrow: "Corgi Champion",
      subtitle: `All ${TOTAL_LEVELS} levels cleared and every snack scooped up.`,
      detail: "That was a very good corgi run.",
      action: "Press Space, tap, or R to play again",
      cardW: 532,
      cardH: 274,
      backdrop: "rgba(255, 247, 252, 0.68)",
      panelStops: ["rgba(255, 252, 249, 0.99)", "rgba(255, 238, 247, 0.98)", "rgba(249, 236, 255, 0.98)"],
      badgeFill: "rgba(255, 248, 251, 0.94)",
      badgeStroke: "rgba(238, 183, 211, 0.78)",
      badgeText: "#d1789d",
      titleColor: "#5e6384",
      bodyColor: "#897497",
      detailColor: "#bf6f95",
      actionFill: "rgba(255, 255, 255, 0.94)",
      actionStroke: "rgba(240, 188, 214, 0.88)",
      actionText: "#c36d93",
      icons: ["cinnamonroll", "cupcake", "pizza", "mochidonut", "corndog"],
      celebrate: true,
    };
  }

  return null;
}

function drawStageOverlay() {
  const config = getStageOverlayConfig();
  if (!config) return;

  const now = performance.now() * 0.001;
  const floatY = Math.sin(now * 1.7) * 3.5;
  const cardW = Math.min(canvas.width - 88, config.cardW);

  ctx.save();
  const subtitleLineH = 25;
  const detailLineH = 21;
  const subtitleMaxW = cardW - 104;
  const detailMaxW = cardW - 116;
  ctx.font = "600 18px system-ui, Segoe UI, sans-serif";
  const subtitleBlock = getWrappedTextBlock(config.subtitle, subtitleMaxW, subtitleLineH);
  ctx.font = "600 15px system-ui, Segoe UI, sans-serif";
  const detailBlock = getWrappedTextBlock(config.detail, detailMaxW, detailLineH);

  const iconRowH = config.icons.length > 0 ? (mode === "gamecomplete" ? 34 : 30) : 0;
  const badgeH = 32;
  const titleH = mode === "start" ? 42 : 38;
  const actionH = 42;
  const topPad = mode === "level-complete" ? 30 : 28;
  const bottomPad = mode === "level-complete" ? 30 : 28;
  const gapAfterIcons = iconRowH > 0 ? 14 : 0;
  const gapAfterBadge = 18;
  const gapAfterTitle = 18;
  const gapBetweenText = detailBlock.height > 0 ? 16 : 0;
  const gapBeforeAction = 24;
  const bodyH =
    iconRowH +
    gapAfterIcons +
    badgeH +
    gapAfterBadge +
    titleH +
    gapAfterTitle +
    subtitleBlock.height +
    gapBetweenText +
    detailBlock.height +
    gapBeforeAction +
    actionH;
  const cardH = Math.max(config.cardH, topPad + bodyH + bottomPad);
  const x = (canvas.width - cardW) / 2;
  const y = (canvas.height - cardH) / 2 + floatY;
  const cx = x + cardW / 2;
  let currentY = y + (cardH - (topPad + bodyH + bottomPad)) / 2 + topPad;

  ctx.fillStyle = config.backdrop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [gx, gy, size, color, phase] of [
    [x + 44, y + 42, 42, "rgba(255, 217, 235, 0.42)", 0],
    [x + cardW - 54, y + 58, 36, "rgba(225, 235, 255, 0.42)", 1.4],
    [x + 70, y + cardH - 48, 26, "rgba(255, 240, 210, 0.34)", 2.1],
  ]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(gx + Math.cos(now * 1.2 + phase) * 4, gy + Math.sin(now * 1.4 + phase) * 4, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const panel = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
  panel.addColorStop(0, config.panelStops[0]);
  panel.addColorStop(0.55, config.panelStops[1]);
  panel.addColorStop(1, config.panelStops[2]);
  ctx.fillStyle = panel;
  roundRectPath(ctx, x, y, cardW, cardH, 28);
  ctx.fill();

  ctx.strokeStyle = "rgba(230, 170, 205, 0.72)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, x + 1, y + 1, cardW - 2, cardH - 2, 27);
  ctx.stroke();

  if (config.icons.length > 0) {
    const iconY = currentY + iconRowH / 2;
    const iconSize = mode === "gamecomplete" ? 28 : 24;
    for (let i = 0; i < config.icons.length; i++) {
      const spread = (i - (config.icons.length - 1) / 2) * 32;
      drawOverlayIconValue(
        config.icons[i],
        cx + spread,
        iconY + Math.sin(now * 2.2 + i * 0.7) * 3,
        iconSize,
        mode === "gamecomplete" ? 0.95 : 0.82
      );
    }
    currentY += iconRowH + gapAfterIcons;
  }

  if (config.celebrate) {
    for (let i = 0; i < 6; i++) {
      const orbitX = cx + Math.cos(now * 1.25 + i) * (cardW * 0.34);
      const orbitY = y + cardH * 0.48 + Math.sin(now * 1.55 + i * 1.3) * (cardH * 0.28);
      drawSnackSprite(SNACK_SET[i % SNACK_SET.length].id, orbitX, orbitY, 26, 0.42);
    }
  }

  drawOverlayBadge(cx, currentY + badgeH / 2, config.eyebrow, config.badgeFill, config.badgeStroke, config.badgeText);
  currentY += badgeH + gapAfterBadge;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = config.titleColor;
  ctx.font = mode === "start" ? "800 34px system-ui, Segoe UI, sans-serif" : "800 32px system-ui, Segoe UI, sans-serif";
  ctx.fillText(config.title, cx, currentY + titleH / 2);
  currentY += titleH + gapAfterTitle;

  ctx.fillStyle = config.bodyColor;
  ctx.font = "600 18px system-ui, Segoe UI, sans-serif";
  drawCenteredWrappedText(subtitleBlock.lines, cx, currentY, subtitleLineH);
  currentY += subtitleBlock.height;

  if (detailBlock.height > 0) {
    currentY += gapBetweenText;
    ctx.fillStyle = config.detailColor;
    ctx.font = "600 15px system-ui, Segoe UI, sans-serif";
    drawCenteredWrappedText(detailBlock.lines, cx, currentY, detailLineH);
    currentY += detailBlock.height;
  }

  currentY += gapBeforeAction;
  drawOverlayActionPill(cx, currentY + actionH / 2, config.action, config.actionFill, config.actionStroke, config.actionText);
  ctx.restore();
}

function drawDebugPlayerTurnHud() {
  if (!DEBUG_PLAYER_TURNS || mode !== "playing") return;
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  const fc = Math.floor(cx / TILE);
  const fr = Math.floor(cy / TILE);
  const colMid = fc * TILE + TILE / 2;
  const rowMid = fr * TILE + TILE / 2;
  const distCx = Math.abs(cx - colMid);
  const distCy = Math.abs(cy - rowMid);
  let probe = "probe: —";
  if (requestedDirection && requestedDirection !== currentDirection) {
    const perp90 = isHorizontal(currentDirection) !== isHorizontal(requestedDirection);
    const walk =
      perp90 ? neighborWalkableFor90Turn(currentDirection, requestedDirection) : neighborWalkable(requestedDirection);
    const aligned = isAlignedForTurn(currentDirection, requestedDirection);
    probe = `probe: walk=${walk ? "ok" : "NO"} align=${aligned ? "ok" : "NO"}`;
  }
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(6, 6, 452, 122);
  ctx.fillStyle = "#e8ffd8";
  ctx.font = "600 11px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = [
    `current: ${currentDirection}   requested: ${requestedDirection ?? "—"}`,
    `tile (${fc},${fr})   |cx-colMid|=${distCx.toFixed(1)} |cy-rowMid|=${distCy.toFixed(1)}   tol≤${TURN_DEADZONE.toFixed(1)}`,
    probe,
    `last tryExecute: ${lastTurnDebugReject}`,
  ];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 12, 12 + i * 26);
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFrameBackdrop();
  drawCelebrationBackdropEffects();
  ctx.save();
  ctx.translate(FRAME_PAD, FRAME_PAD);
  drawMaze();
  drawPickupParticles();
  drawCats();
  drawCorgi();
  drawSafeTimeHint();
  drawDebugPlayerTurnHud();
  ctx.restore();
  drawGardenBorder();
  drawStageOverlay();
}

// --- Input ---
window.addEventListener("keydown", (e) => {
  const targetTag = e.target && typeof e.target.tagName === "string" ? e.target.tagName : "";
  const wantsPrimaryAction = e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter";
  const isUiControl = targetTag === "BUTTON" || targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT";

  if (e.code === "KeyR" || wantsPrimaryAction || e.code.startsWith("Arrow")) {
    unlockAudioFromUserGesture();
  }
  if (wantsPrimaryAction && !isUiControl) {
    e.preventDefault();
    if (handlePrimaryScreenAction()) return;
  }
  if (e.code === "KeyR") {
    resetGame();
    return;
  }
  if (e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    keys[e.code] = true;
    const t = performance.now();
    requestedLastKeydownAt = t;
    requestedExpireAt = t + REQUESTED_DIRECTION_MAX_MS;
    if (e.code === "ArrowUp") requestedDirection = "up";
    if (e.code === "ArrowDown") requestedDirection = "down";
    if (e.code === "ArrowLeft") requestedDirection = "left";
    if (e.code === "ArrowRight") requestedDirection = "right";
  }
});

canvas.addEventListener("pointerdown", () => {
  handlePrimaryScreenAction();
});

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    keys[e.code] = false;
  }
});

window.addEventListener("blur", () => {
  keys.ArrowUp = keys.ArrowDown = keys.ArrowLeft = keys.ArrowRight = false;
  requestedDirection = null;
  requestedExpireAt = 0;
  requestedLastKeydownAt = 0;
});

// --- Loop ---
let lastT = performance.now();

function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > DT_CAP) dt = DT_CAP;

  update(dt);
  draw();
  requestAnimationFrame(frame);
}

showStartScreen();
requestAnimationFrame(frame);
