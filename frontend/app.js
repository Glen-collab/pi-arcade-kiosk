const allGrid = document.getElementById("grid");
const top10Grid = document.getElementById("top10");
const top10Section = document.getElementById("top10-section");
const status = document.getElementById("status");
const search = document.getElementById("search");
const allHeading = document.getElementById("all-heading");
const exitTile = document.getElementById("exit-tile");
const systemPill = document.getElementById("system-pill");

// The BSA kiosk admin picks NES or SNES; that decision is encoded in
// the URL the Pi's Chromium opens (?system=nes|snes). When set, we
// scope every API call to that library so the user only sees games for
// the system they picked.
const systemFilter = (new URLSearchParams(window.location.search).get("system") || "").toLowerCase();
if (systemFilter === "nes" || systemFilter === "snes") {
  systemPill.textContent = systemFilter.toUpperCase();
  systemPill.hidden = false;
  document.body.classList.add(`system-${systemFilter}`);
}

let allGames = [];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function makeTile(game, opts = {}) {
  const tile = document.createElement("button");
  tile.className = "tile" + (opts.top ? " top" : "");
  const rank = opts.rank ? `<span class="tile-rank">#${opts.rank}</span>` : "";
  const plays = game.plays > 0 ? `<span class="tile-plays">${game.plays}▶</span>` : "";
  tile.innerHTML = `${rank}${plays}<div class="tile-title">${escapeHtml(game.title)}</div>`;
  tile.addEventListener("click", () => launch(game));
  return tile;
}

// Top section size — show up to 20 most-played. Glen's gym kiosk has
// 800+ NES + 461 SNES ROMs total, so the popular ones surface naturally
// via play count rather than pre-curated lists. Most-played fills out
// quickly once a few sessions are logged.
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
    allGrid.innerHTML = `<div class="empty">No games match "${escapeHtml(query)}".</div>`;
    allHeading.textContent = "All Games (A–Z)";
    return;
  }
  allHeading.textContent = query
    ? `Search: "${query}" (${list.length} match${list.length === 1 ? "" : "es"})`
    : `All Games A–Z (${list.length})`;
  const frag = document.createDocumentFragment();
  list.forEach(g => frag.appendChild(makeTile(g)));
  allGrid.appendChild(frag);
}

async function launch(game) {
  status.textContent = `Launching ${game.title}...`;
  try {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: game.system, rom: game.rom }),
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = `Running ${game.title} — F4 to quit`;
      const g = allGames.find(x => x.id === game.id);
      if (g) {
        g.plays = data.plays != null ? data.plays : (g.plays + 1);
        renderTop10();
        renderAll(search.value.trim());
      }
    } else {
      status.textContent = `Error: ${data.error || "launch failed"}`;
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function load() {
  status.textContent = "Loading...";
  try {
    const url = systemFilter ? `/api/games?system=${encodeURIComponent(systemFilter)}` : "/api/games";
    const res = await fetch(url);
    const data = await res.json();
    allGames = data.games || [];
    status.textContent = `${allGames.length} games`;
    renderTop10();
    renderAll();
  } catch (err) {
    status.textContent = `Failed to load: ${err.message}`;
  }
}

async function exitToWorkouts() {
  exitTile.disabled = true;
  status.textContent = "Returning to workouts...";
  try {
    await fetch("/api/exit-to-workouts", { method: "POST" });
    // No need to re-enable — the Pi-side script will kill this page.
  } catch (err) {
    status.textContent = `Exit failed: ${err.message}`;
    exitTile.disabled = false;
  }
}
exitTile.addEventListener("click", exitToWorkouts);

let searchTimer = null;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderAll(search.value.trim()), 80);
});

load();
