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

// Cocktail-table mode. ?table=1 narrows the grid to games that work with two
// players sitting on opposite sides, and ?rotate=0..3 sets the RetroArch
// output rotation for every launch from this picker. They are separate knobs
// on purpose: a table can be worth filtering for without needing a flip (the
// panel may already be mounted to face the player who picks), and a rotated
// panel may want the full library.
const params       = new URLSearchParams(window.location.search);
const tableMode    = ["1", "true", "yes"].includes((params.get("table") || "").toLowerCase());
const rotateParam  = params.get("rotate");
const tableRotation = /^[0-3]$/.test(rotateParam || "") ? Number(rotateParam) : null;
if (tableMode) document.body.classList.add("table-mode");

const systemFilter = (new URLSearchParams(window.location.search).get("system") || "").toLowerCase();
if (["nes", "snes", "n64", "gba"].includes(systemFilter)) {
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

// Latest gamepad index that fired a launch press. Captured by the
// gamepad poll loop and consumed by launch() so the backend knows
// which physical pad to pin RetroArch's Player 1 to. -1 means "no
// gamepad / launched via mouse/keyboard"; backend falls back to its
// default joypad index in that case.
let lastLaunchGamepadIdx = -1;

// Per-pad last-activity timestamp (Date.now() ms). Updated by the
// gamepad poll loop whenever a pad presses a button or moves its
// D-pad past the deadzone. At launch time we count pads active within
// PAD_ACTIVITY_WINDOW_MS and pass it to the backend as num_users —
// RetroArch's input_max_users then matches the count of pads that
// actually look alive, so a still-paired-but-silent dongle won't
// trigger games like MK3 to auto-jump to VS mode while at the same
// time letting 2-player work the moment both pads are firing.
const padActivity = new Map();
const PAD_ACTIVITY_WINDOW_MS = 30000;
function countActivePads() {
  const now = Date.now();
  let n = 0;
  for (const t of padActivity.values()) {
    if (now - t < PAD_ACTIVITY_WINDOW_MS) n++;
  }
  return n;
}

function makeTile(game, opts = {}) {
  const tile = document.createElement("button");
  tile.className = "tile" + (opts.top ? " top" : "");
  const rank  = opts.rank ? `<span class="tile-rank">${opts.rank}</span>` : "";
  const plays = game.plays > 0 ? `<span class="tile-plays">${game.plays}</span>` : "";
  // In table mode the seating hint is the single most useful thing on the
  // tile: it tells you where to sit before you start, not after.
  let seat = "";
  if (tableMode && game.seating) {
    const label = { "split-screen": "SPLIT VIEW", "single-player": "1 PLAYER" }[game.seating];
    if (label) seat = `<span class="tile-seat seat-${game.seating}">${label}</span>`;
  }
  tile.innerHTML = `${rank}${plays}${seat}<div class="tile-title">${escapeHtml(game.title)}</div>`;
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
  // Flip wasPlaying optimistically so the gamepad poll loop stops
  // forwarding face-button presses to tile.click() in the gap between
  // the user clicking a tile and the next /api/status poll seeing the
  // new retroarch process. Without this, pressing A inside a fighting
  // game makes the picker behind RetroArch launch the NEXT alphabetical
  // game (MK3 → MK2 → MK1, etc.). The setInterval below resyncs it on
  // its normal cadence; this is just to close the launch-race window.
  wasPlaying = true;
  status.textContent = `LAUNCHING ${game.title.toUpperCase()}...`;
  const body = { system: game.system, rom: game.rom };
  if (lastLaunchGamepadIdx >= 0) body.joypad_index = lastLaunchGamepadIdx;
  // Number of pads that pressed something in the last 30 seconds. The
  // launcher uses this for RetroArch's input_max_users so 2-player
  // games light up the second port only when there's actually a
  // second pad to drive it.
  const activeCount = countActivePads();
  if (activeCount > 0) body.num_users = activeCount;
  if (tableRotation !== null) body.rotation = tableRotation;
  // Table mode turns on the split shader for this launch only.
  if (tableMode) body.cocktail = 1;
  try {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

// On a BSA gym TV the top tile hands the display back to the workout view. A
// standalone cabinet has no switch script, so that tile is dead weight there —
// swap it for a system switcher, which is what you actually want when one
// picker holds two libraries. /api/status reports which case we are in, so the
// same build serves both installs.
async function configureTopTile() {
  let st;
  try { st = await (await fetch("/api/status")).json(); } catch { return; }
  if (st.workouts_available) return;            // gym TV: leave it alone

  const systems = st.systems || [];
  if (!systems.length) { exitTile.hidden = true; return; }

  const section = document.getElementById("exit-section");
  section.innerHTML = "";
  const mk = (label, sys) => {
    const b = document.createElement("button");
    b.className = "tile exit-tile" + (systemFilter === sys ? " system-current" : "");
    b.dataset.nav = "0";
    b.innerHTML = `<span class="tile-title">${label}</span>`;
    b.addEventListener("click", () => {
      // Preserve every other parameter; only the system changes. Losing
      // table=1 here would silently drop the cabinet out of cocktail mode.
      const p = new URLSearchParams(window.location.search);
      if (sys) p.set("system", sys); else p.delete("system");
      window.location.search = p.toString();
    });
    return b;
  };
  section.appendChild(mk("ALL GAMES", ""));
  for (const sys of systems) section.appendChild(mk(sys.toUpperCase(), sys));
}
configureTopTile();

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

const gpState = { dirHeldSince: 0, lastTick: 0, lastDir: null, launchPrev: false };

function listGamepads() {
  // Every connected pad, in array order. Chromium leaves disconnected
  // slots as null. The kiosk has two DragonRise dongles plugged in but
  // only one pad paired at a time — we can't predict which dongle the
  // active pad's radio bonded to, and the kernel may assign /dev/input/
  // js0 to the silent dongle. So we read ALL pads each frame and OR
  // their inputs together; whichever pad is actually sending events
  // drives the picker.
  const pads = navigator.getGamepads?.() || [];
  return Array.from(pads).filter(gp => gp && gp.connected);
}

// Build a virtual "merged pad" from every connected gamepad — any pad
// pressing a direction or button counts. Returns null if no pad is
// connected so the polling loop can short-circuit. Also returns the
// `launchIdx` of whichever pad fired a face button (-1 if none) so the
// launch call can tell the backend which joypad RetroArch should bind
// to Player 1.
function readMergedInput() {
  const pads = listGamepads();
  if (!pads.length) return null;
  let dir = null;
  let launch = false;
  let launchIdx = -1;
  const now = Date.now();
  for (const gp of pads) {
    // Activity tracking — any pressed button or axis outside the
    // deadzone counts as a live pad for the activity window.
    let padFiring = false;
    for (let b = 0; b < gp.buttons.length; b++) {
      if (gp.buttons[b]?.pressed) { padFiring = true; break; }
    }
    if (!padFiring) {
      for (const ax of gp.axes) {
        if (Math.abs(ax) > 0.5) { padFiring = true; break; }
      }
    }
    if (padFiring) padActivity.set(gp.index, now);

    if (!dir) {
      if      (gp.buttons[12]?.pressed || (gp.axes[1] ?? 0) < -0.5) dir = "up";
      else if (gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) >  0.5) dir = "down";
      else if (gp.buttons[14]?.pressed || (gp.axes[0] ?? 0) < -0.5) dir = "left";
      else if (gp.buttons[15]?.pressed || (gp.axes[0] ?? 0) >  0.5) dir = "right";
    }
    if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed ||
        gp.buttons[2]?.pressed || gp.buttons[3]?.pressed) {
      launch = true;
      if (launchIdx === -1) launchIdx = gp.index;
    }
  }
  return { dir, launch, launchIdx };
}

function pollGamepad() {
  const input = readMergedInput();
  if (!input) return requestAnimationFrame(pollGamepad);

  const launchNow = input.launch;

  // Chromium polls the gamepad API even when RetroArch is the foreground
  // window — so without this guard, every face-button press inside a
  // running game also tries to launch the focused tile in the picker
  // behind it. Skip all picker input processing while a game is alive,
  // but keep launchPrev in sync so a held button (during a Select+Start
  // exit chord, say) doesn't fire a "launch focused tile" the instant
  // wasPlaying flips back to false.
  if (wasPlaying) {
    gpState.launchPrev = launchNow;
    gpState.lastDir = null;
    return requestAnimationFrame(pollGamepad);
  }

  const now = performance.now();

  // Direction is the merged direction from any connected pad. D-pads
  // come through as axes 0/1 on DragonRise pads; buttons 12-15 cover
  // standard-mapped pads as a fallback. (Threshold + merge live in
  // readMergedInput.)
  const dir = input.dir;

  if (dir) {
    if (dir !== gpState.lastDir) {
      moveFocus(dir);
      noteInput();
      gpState.lastDir = dir;
      gpState.dirHeldSince = now;
      gpState.lastTick = now;
    } else if (now - gpState.dirHeldSince > GP_REPEAT_INITIAL_MS &&
               now - gpState.lastTick > GP_REPEAT_RATE_MS) {
      moveFocus(dir);
      noteInput();
      gpState.lastTick = now;
    }
  } else {
    gpState.lastDir = null;
  }

  // Any face button (0/1/2/3) launches the focused tile. Cheap knockoff
  // pads don't expose a Chromium "standard" mapping, so the physical
  // "A" can land on any index — accept all four so the user doesn't
  // have to guess. Deliberately NOT including Start (9): Select+Start
  // is the RetroArch exit chord, and Chromium still sees the Start
  // press in the background when the user exits a game. Counting it
  // as a launch press would auto-relaunch the focused tile the moment
  // the user exits a game. Rising-edge only. (launchNow computed above.)
  if (launchNow && !gpState.launchPrev) {
    // Remember which pad fired so launch() can pin RetroArch Player 1
    // to it. Captured here so the value reflects the press event itself
    // rather than whatever state the pad is in by the time fetch fires.
    lastLaunchGamepadIdx = input.launchIdx;
    noteInput();
    tiles[focusIdx]?.click();
  }
  gpState.launchPrev = launchNow;

  requestAnimationFrame(pollGamepad);
}

window.addEventListener("gamepadconnected", () => {
  status.textContent = "GAMEPAD CONNECTED";
  // Kick off polling on first connect; the loop self-restarts via rAF.
  requestAnimationFrame(pollGamepad);
});

// ── Boot ──────────────────────────────────────────────────────
async function load() {
  // Kill any orphaned RetroArch from a previous picker session before
  // we settle into the new page. Chromium respawns (mode flips, agent
  // reload, manual pkill chromium) leave an in-flight game running
  // beneath the new Chromium window; without this nudge, the picker
  // is visually on top of a live game and the wasPlaying guard then
  // silently blocks all gamepad input. /api/quit is a no-op if no
  // game is running.
  try {
    await fetch("/api/quit", { method: "POST" });
    wasPlaying = false;
  } catch (e) { /* fall through — picker still loads */ }
  status.textContent = "LOADING...";
  try {
    const q = [];
    if (systemFilter) q.push(`system=${encodeURIComponent(systemFilter)}`);
    if (tableMode) q.push("tabletop=1");
    const url = q.length ? `/api/games?${q.join("&")}` : "/api/games";
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
    { rom: "Donkey Kong Country (U) (V1.2) [!].zip" },
    { rom: "Super Mario All-Stars + Super Mario World (U) [!].zip" },
    { rom: "Super Metroid (JU) [!].zip" },
    { rom: "Chrono Trigger (U) [!].zip" },
    { rom: "Street Fighter II - The World Warrior (U) [!].zip" },
    { rom: "Killer Instinct (U) (V1.1) [!].zip" },
    { rom: "Super Mario World 2 - Yoshi's Island (U) (M3) (V1.1).zip" },
  ],
  n64: [
    { rom: "Mario Kart 64 (U) [!].z64" },
  ],
  gba: [
    { rom: "Castlevania - Circle of the Moon # GBA.GBA" },
  ],
};
let lastInput = Date.now();
let attractIdx = 0;
let wasPlaying = false;

// Select+Start on the picker = shut the cabinet down.
//
// The same combo quits a game back here, so there is one thing to learn and no
// extra button to wire into the cabinet. It must be HELD, because the combo is
// easy to brush while mashing and a cabinet that powers off mid-session is
// worse than one with no shutdown at all. The overlay counts down so you can
// see it coming and let go.
const SHUTDOWN_HOLD_MS = 2000;
const SELECT_BTN = 8, START_BTN = 9;
let shutdownHeldSince = 0;
let shuttingDown = false;

let menuOpen = false;
let menuRow = 0;
let settings = { volume: null, brightness: null };
let navHeld = false;
// Set whenever a game is running, so the combo that quit it cannot roll
// straight into opening the settings menu. Cleared on a clean release.
let comboMustRelease = true;

function overlayEl() {
  let el = document.getElementById("shutdown-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "shutdown-overlay";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

// Rows are built from what the machine can actually do. Brightness rides
// DDC/CI, which plenty of monitors ignore, so /api/settings returns null for
// anything unavailable and that row simply is not offered.
function menuRows() {
  const rows = [];
  if (settings.volume !== null)     rows.push({ key: "volume",     label: "VOLUME" });
  if (settings.brightness !== null) rows.push({ key: "brightness", label: "BRIGHTNESS" });
  rows.push({ key: "shutdown", label: "SHUT DOWN" });
  rows.push({ key: "close",    label: "BACK TO GAMES" });
  return rows;
}

function drawMenu() {
  const el = overlayEl();
  const rows = menuRows();
  menuRow = Math.max(0, Math.min(menuRow, rows.length - 1));
  el.innerHTML = `<div class="menu-box">
    <div class="menu-title">SETTINGS</div>
    ${rows.map((r, i) => {
      const sel = i === menuRow ? " selected" : "";
      let right = "";
      if (r.key === "volume" || r.key === "brightness") {
        const v = settings[r.key];
        const filled = Math.round(v / 10);
        right = `<span class="menu-bar">${"#".repeat(filled)}${".".repeat(10 - filled)}</span>
                 <span class="menu-val">${v}%</span>`;
      }
      return `<div class="menu-row${sel}"><span>${r.label}</span><span>${right}</span></div>`;
    }).join("")}
    <div class="menu-hint">D-PAD to move &middot; LEFT/RIGHT to adjust &middot; A to pick &middot; B to close</div>
  </div>`;
  el.hidden = false;
}

async function refreshSettings() {
  try { settings = await (await fetch("/api/settings")).json(); } catch {}
}

async function adjust(key, delta) {
  const cur = settings[key];
  if (cur === null) return;
  const next = Math.max(0, Math.min(100, cur + delta));
  settings[key] = next;
  drawMenu();
  try {
    await fetch(`/api/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    });
  } catch {}
}

async function openMenu() {
  await refreshSettings();
  menuOpen = true;
  menuRow = 0;
  drawMenu();
}

function closeMenu() {
  menuOpen = false;
  overlayEl().hidden = true;
  lastInput = Date.now();   // don't let the attract timer fire on the way out
}

function doShutdown() {
  shuttingDown = true;
  const el = overlayEl();
  el.innerHTML = `<div class="menu-box"><div class="menu-title">SHUTTING DOWN</div>
    <div class="menu-hint">WAIT FOR THE SCREEN TO GO BLACK, THEN SWITCH OFF</div></div>`;
  el.hidden = false;
  fetch("/api/shutdown", { method: "POST" }).catch(() => {});
}

function pollSettingsMenu() {
  if (shuttingDown) return;
  const pads = listGamepads();

  if (menuOpen) {
    let dir = null, confirm = false, back = false;
    for (const gp of pads) {
      if (gp.buttons[12]?.pressed || (gp.axes[1] ?? 0) < -0.5) dir = "up";
      else if (gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) > 0.5) dir = "down";
      else if (gp.buttons[14]?.pressed || (gp.axes[0] ?? 0) < -0.5) dir = "left";
      else if (gp.buttons[15]?.pressed || (gp.axes[0] ?? 0) > 0.5) dir = "right";
      if (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed) confirm = true;
      if (gp.buttons[2]?.pressed || gp.buttons[3]?.pressed) back = true;
    }
    // Edge-trigger everything: a held direction must not run the volume to
    // zero, and a held A must not re-fire on the row underneath.
    if (!dir && !confirm && !back) { navHeld = false; return; }
    if (navHeld) return;
    navHeld = true;

    const rows = menuRows();
    const row = rows[menuRow];
    if (dir === "up")   { menuRow = (menuRow - 1 + rows.length) % rows.length; drawMenu(); }
    if (dir === "down") { menuRow = (menuRow + 1) % rows.length; drawMenu(); }
    if (dir === "left"  && (row.key === "volume" || row.key === "brightness")) adjust(row.key, -5);
    if (dir === "right" && (row.key === "volume" || row.key === "brightness")) adjust(row.key, +5);
    if (back) closeMenu();
    if (confirm) {
      if (row.key === "close") closeMenu();
      else if (row.key === "shutdown") doShutdown();
    }
    return;
  }

  // Closed: watch for the open combo. While a game is up RetroArch owns
  // Select+Start and uses it to exit, so the picker must ignore it then or
  // quitting a game becomes impossible.
  const el = overlayEl();
  if (wasPlaying) {
    shutdownHeldSince = 0;
    // Quitting a game IS this combo. The player is still holding it at the
    // moment RetroArch dies, so without this latch the picker sees the combo
    // the instant it regains control and opens settings on someone who was
    // only trying to get back to the grid. Require a clean release first.
    comboMustRelease = true;
    el.hidden = true;
    return;
  }

  const held = pads.some(
    gp => gp.buttons[SELECT_BTN]?.pressed && gp.buttons[START_BTN]?.pressed
  );
  if (comboMustRelease) {
    if (!held) comboMustRelease = false;   // released: arm it again
    shutdownHeldSince = 0;
    el.hidden = true;
    return;
  }
  if (!held) { shutdownHeldSince = 0; if (!menuOpen) el.hidden = true; return; }

  const now = Date.now();
  if (!shutdownHeldSince) shutdownHeldSince = now;
  const left = SHUTDOWN_HOLD_MS - (now - shutdownHeldSince);
  if (left > 0) {
    el.hidden = false;
    el.innerHTML = `<div class="menu-box"><div class="menu-title">SETTINGS IN ${Math.ceil(left / 1000)}...</div>
      <div class="menu-hint">RELEASE TO CANCEL</div></div>`;
    return;
  }
  shutdownHeldSince = 0;
  navHeld = true;          // don't let the same press select a row instantly
  openMenu();
}
setInterval(pollSettingsMenu, 100);

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

  const sys = ATTRACT_DEMOS[systemFilter] ? systemFilter : "nes";
  const pool = ATTRACT_DEMOS[sys] || [];
  if (!pool.length) return;
  const pick = pool[attractIdx % pool.length];
  attractIdx++;
  status.textContent = `DEMO MODE - F4 OR ENTER TO PLAY`;
  try {
    await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Attract demos need the split as much as real play does — arguably more.
      // This is the screen an idle cabinet shows, so an unsplit demo reads as
      // a broken table to whoever walks past, not as a screensaver.
      body: JSON.stringify(
        tableMode ? { system: sys, rom: pick.rom, cocktail: 1 }
                  : { system: sys, rom: pick.rom }
      ),
    });
  } catch {}
}, 5000);

load();
