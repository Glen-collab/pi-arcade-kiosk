// Pi Arcade picker — old-school cabinet UX.
// Supports keyboard arrows + Enter and the Gamepad API (D-pad + A/B).
// Spatial navigation: ↑/↓/←/→ pick the nearest tile in that direction,
// so the grid's column count doesn't matter and wrapping is natural.

const allGrid       = document.getElementById("grid");
const top10Grid     = document.getElementById("top10");
const top10Section  = document.getElementById("top10-section");
const status        = document.getElementById("status");
const search        = document.getElementById("search");
const allHeading    = document.getElementById("all-heading");
const exitTile      = document.getElementById("exit-tile");
const systemPill    = document.getElementById("system-pill");

const systemFilter = (new URLSearchParams(window.location.search).get("system") || "").toLowerCase();
if (systemFilter === "nes" || systemFilter === "snes") {
  systemPill.textContent = systemFilter.toUpperCase();
  systemPill.hidden = false;
  document.body.classList.add(`system-${systemFilter}`);
}

let allGames = [];
let tiles = [];      // ordered NodeList-like array of every focusable tile
let focusIdx = 0;    // current focused tile index

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function makeTile(game, opts = {}) {
  const tile = document.createElement("button");
  tile.className = "tile" + (opts.top ? " top" : "");
  const rank  = opts.rank ? `<span class="tile-rank">${opts.rank}</span>` : "";
  const plays = game.plays > 0 ? `<span class="tile-plays">${game.plays}</span>` : "";
  tile.innerHTML = `${rank}${plays}<div class="tile-title">${escapeHtml(game.title)}</div>`;
  tile.addEventListener("click", () => launch(game));
  return tile;
}

const TOP_SECTION_SIZE = 20;

function renderTop10() {
  const ranked = allGames
    .filter(g => g.plays > 0)
    .sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title))
    .slice(0, TOP_SECTION_SIZE);
  top10Grid.innerHTML = "";
  if (!ranked.length) {
    top10Section.hidden = true;
    return;
  }
  top10Section.hidden = false;
  ranked.forEach((g, i) => top10Grid.appendChild(makeTile(g, { top: true, rank: i + 1 })));
}

function renderAll(query = "") {
  let list = allGames.slice().sort((a, b) => a.title.localeCompare(b.title));
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(g => g.title.toLowerCase().includes(q));
  }
  allGrid.innerHTML = "";
  if (!list.length) {
    allGrid.innerHTML = `<div class="empty">No games match "${escapeHtml(query)}"</div>`;
    allHeading.textContent = "All Games";
    return;
  }
  allHeading.textContent = query
    ? `Search: "${query}" (${list.length})`
    : `All Games (${list.length})`;
  const frag = document.createDocumentFragment();
  list.forEach(g => frag.appendChild(makeTile(g)));
  allGrid.appendChild(frag);
}

async function launch(game) {
  status.textContent = `LAUNCHING ${game.title.toUpperCase()}...`;
  try {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: game.system, rom: game.rom }),
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = `RUNNING ${game.title.toUpperCase()} - F4 TO QUIT`;
      const g = allGames.find(x => x.id === game.id);
      if (g) {
        g.plays = data.plays != null ? data.plays : (g.plays + 1);
        renderTop10();
        renderAll(search.value.trim());
        rebuildTileList();
      }
    } else {
      status.textContent = `ERROR: ${data.error || "launch failed"}`;
    }
  } catch (err) {
    status.textContent = `ERROR: ${err.message}`;
  }
}

async function exitToWorkouts() {
  exitTile.disabled = true;
  status.textContent = "RETURNING TO WORKOUTS...";
  try {
    await fetch("/api/exit-to-workouts", { method: "POST" });
  } catch (err) {
    status.textContent = `EXIT FAILED: ${err.message}`;
    exitTile.disabled = false;
  }
}
exitTile.addEventListener("click", exitToWorkouts);

// ── Navigation ────────────────────────────────────────────────
// Rebuilds the ordered tile list. Called after every re-render so
// keyboard/gamepad input always sees the current grid.
function rebuildTileList() {
  tiles = Array.from(document.querySelectorAll(".tile"));
  if (focusIdx >= tiles.length) focusIdx = tiles.length - 1;
  if (focusIdx < 0) focusIdx = 0;
  applyFocus();
}

function applyFocus() {
  tiles.forEach((t, i) => t.classList.toggle("focused", i === focusIdx));
  const t = tiles[focusIdx];
  if (t) t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

// Spatial navigation: from the focused tile, pick the nearest tile
// whose center sits in the requested direction. Handles grids with any
// column count and naturally wraps between sections (exit → top → all).
function moveFocus(direction) {
  if (!tiles.length) return;
  const cur = tiles[focusIdx].getBoundingClientRect();
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < tiles.length; i++) {
    if (i === focusIdx) continue;
    const r = tiles[i].getBoundingClientRect();
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const dx = tx - cx, dy = ty - cy;
    // Require the candidate to actually be in the requested direction.
    // 8px tolerance forgives sub-pixel rendering and same-row jitter.
    if (direction === "up"    && dy >= -8) continue;
    if (direction === "down"  && dy <=  8) continue;
    if (direction === "left"  && dx >= -8) continue;
    if (direction === "right" && dx <=  8) continue;
    // Weight the perpendicular axis more so up/down doesn't drift
    // diagonally across the grid.
    const score = (direction === "up" || direction === "down")
      ? Math.abs(dy) + Math.abs(dx) * 2
      : Math.abs(dx) + Math.abs(dy) * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best !== -1) {
    focusIdx = best;
    applyFocus();
  }
}

// Skip nav when the search input owns focus — let the user type.
function isTypingInSearch() {
  return document.activeElement === search;
}

document.addEventListener("keydown", (e) => {
  if (isTypingInSearch() && e.key !== "Escape" && e.key !== "Enter") return;
  switch (e.key) {
    case "ArrowUp":    e.preventDefault(); moveFocus("up");    break;
    case "ArrowDown":  e.preventDefault(); moveFocus("down");  break;
    case "ArrowLeft":  e.preventDefault(); moveFocus("left");  break;
    case "ArrowRight": e.preventDefault(); moveFocus("right"); break;
    case "Enter":
      e.preventDefault();
      if (isTypingInSearch()) { search.blur(); break; }
      tiles[focusIdx]?.click();
      break;
    case "Escape":
      e.preventDefault();
      if (isTypingInSearch()) { search.blur(); break; }
      // B button equivalent — jump to the Back-to-Workouts tile.
      focusIdx = 0;
      applyFocus();
      break;
  }
});

// ── Gamepad ───────────────────────────────────────────────────
// Polled at requestAnimationFrame. We compare each axis/button to the
// previous frame's state and only fire on rising-edge so holding the
// D-pad doesn't blast through the grid in one second.
const GP_REPEAT_INITIAL_MS = 350;   // hold this long to start repeating
const GP_REPEAT_RATE_MS    = 90;    // then one tick every Nms

const gpState = { dirHeldSince: 0, lastTick: 0, lastDir: null, aPrev: false, bPrev: false };

function readGamepad() {
  const pads = navigator.getGamepads?.() || [];
  for (const gp of pads) {
    if (gp && gp.connected) return gp;
  }
  return null;
}

function pollGamepad() {
  const gp = readGamepad();
  if (!gp) return requestAnimationFrame(pollGamepad);

  const now = performance.now();

  // Direction from D-pad first (standard mapping buttons 12-15), then
  // left analog stick as fallback. Threshold 0.5 to ignore drift.
  let dir = null;
  if      (gp.buttons[12]?.pressed || (gp.axes[1] ?? 0) < -0.5) dir = "up";
  else if (gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) >  0.5) dir = "down";
  else if (gp.buttons[14]?.pressed || (gp.axes[0] ?? 0) < -0.5) dir = "left";
  else if (gp.buttons[15]?.pressed || (gp.axes[0] ?? 0) >  0.5) dir = "right";

  if (dir) {
    if (dir !== gpState.lastDir) {
      moveFocus(dir);
      gpState.lastDir = dir;
      gpState.dirHeldSince = now;
      gpState.lastTick = now;
    } else if (now - gpState.dirHeldSince > GP_REPEAT_INITIAL_MS &&
               now - gpState.lastTick > GP_REPEAT_RATE_MS) {
      moveFocus(dir);
      gpState.lastTick = now;
    }
  } else {
    gpState.lastDir = null;
  }

  // A button = launch focused tile. Rising-edge only.
  const aNow = !!gp.buttons[0]?.pressed;
  if (aNow && !gpState.aPrev) tiles[focusIdx]?.click();
  gpState.aPrev = aNow;

  // B button = jump back to Back-to-Workouts tile (doesn't auto-launch;
  // user still has to press A on it to confirm exit).
  const bNow = !!gp.buttons[1]?.pressed;
  if (bNow && !gpState.bPrev) { focusIdx = 0; applyFocus(); }
  gpState.bPrev = bNow;

  requestAnimationFrame(pollGamepad);
}

window.addEventListener("gamepadconnected", () => {
  status.textContent = "GAMEPAD CONNECTED";
  // Kick off polling on first connect; the loop self-restarts via rAF.
  requestAnimationFrame(pollGamepad);
});

// ── Boot ──────────────────────────────────────────────────────
async function load() {
  status.textContent = "LOADING...";
  try {
    const url = systemFilter ? `/api/games?system=${encodeURIComponent(systemFilter)}` : "/api/games";
    const res = await fetch(url);
    const data = await res.json();
    allGames = data.games || [];
    status.textContent = `${allGames.length} GAMES`;
    renderTop10();
    renderAll();
    rebuildTileList();
    // Start nav on the first actual game tile, not the exit button —
    // less likely the user accidentally exits with a single A press.
    if (tiles.length > 1) focusIdx = 1;
    applyFocus();
    // Pre-start gamepad polling in case the controller was already
    // connected before page load (the connected event won't refire).
    requestAnimationFrame(pollGamepad);
  } catch (err) {
    status.textContent = `FAILED TO LOAD: ${err.message}`;
  }
}

let searchTimer = null;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    renderAll(search.value.trim());
    rebuildTileList();
  }, 80);
});

// ── Attract mode ──────────────────────────────────────────────
// Idle picker → auto-launch a demo game (real arcade behavior). Cycles
// through a curated list of games with built-in attract sequences, so
// the gym TV always feels alive. Any input (key / gamepad / mouse) on
// the picker resets the idle timer. When retroarch dies (F4 quit), the
// picker is back in focus and the timer resets fresh too — so a user
// gets 30s of grace to start picking before the next demo fires.
const IDLE_ATTRACT_MS = 30000;
const ATTRACT_DEMOS = {
  nes: [
    { rom: "Contra (U).nes" },
    { rom: "Super Mario Bros - Duck Hunt (U).nes" },
    { rom: "Pac-Man (U) [!].nes" },
    { rom: "Mega Man 2 (U).nes" },
    { rom: "Donkey Kong Classics (U).nes" },
    { rom: "Tetris (U) [!].nes" },
  ],
  snes: [
    // Lead with games whose attract sequence auto-plays gameplay (not
    // just a select menu). The All-Stars + World combo cart boots to
    // its own SMB1/2/3/World picker which is *not* useful attract —
    // skip it. If a standalone Super Mario World ROM ever lands in
    // roms/snes/, drop it back at the top.
    { rom: "Donkey Kong Country (U) (V1.2) [!].zip" },
    { rom: "Super Metroid (JU) [!].zip" },
    { rom: "Chrono Trigger (U) [!].zip" },
    { rom: "Street Fighter II - The World Warrior (U) [!].zip" },
    { rom: "Killer Instinct (U) (V1.1) [!].zip" },
    { rom: "Super Mario World 2 - Yoshi's Island (U) (M3) (V1.1).zip" },
  ],
};
let lastInput = Date.now();
let attractIdx = 0;
let wasPlaying = false;

function noteInput() { lastInput = Date.now(); }
document.addEventListener("keydown",   noteInput, { capture: true });
document.addEventListener("mousemove", noteInput, { capture: true });
document.addEventListener("mousedown", noteInput, { capture: true });

async function isPlaying() {
  try {
    const r = await fetch("/api/status");
    return (await r.json()).playing;
  } catch { return false; }
}

setInterval(async () => {
  const playing = await isPlaying();
  // User just exited a game (or attract demo) — start a fresh idle
  // countdown instead of immediately blasting the next demo.
  if (wasPlaying && !playing) lastInput = Date.now();
  wasPlaying = playing;
  if (playing) return;

  if (Date.now() - lastInput < IDLE_ATTRACT_MS) return;

  const sys = systemFilter === "snes" ? "snes" : "nes";
  const pool = ATTRACT_DEMOS[sys] || [];
  if (!pool.length) return;
  const pick = pool[attractIdx % pool.length];
  attractIdx++;
  status.textContent = `DEMO MODE - F4 OR ENTER TO PLAY`;
  try {
    await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: sys, rom: pick.rom }),
    });
  } catch {}
}, 5000);

load();
