// Cabinet input layer for the table-arcade games.
//
// The games expect a keyboard and a pointer. This cabinet has two USB gamepads
// and nothing else. Rather than edit eleven games — which would fork them from
// the originals and have to be redone whenever one changes — everything
// cabinet-specific lives here and is injected by the backend.
//
// Two separate bridges, because the games take input two different ways:
//
//   Real-time games  document.addEventListener("keydown", e => ... e.code ...)
//                    so we synthesise KeyboardEvents carrying the right `code`.
//                    They call preventDefault(), so the events must be
//                    cancelable or the handlers misbehave.
//
//   Board games      canvas.addEventListener("pointerdown", ...) reading
//                    getBoundingClientRect() and clientX/clientY. No amount of
//                    key pressing reaches those: there are no elements to
//                    focus, only pixels. They get a virtual cursor that
//                    dispatches genuine pointer events.
//
// Setup screens are plain buttons in every game, and the games ignore keys
// entirely while one is up, so those use the cursor too.
(function () {
  "use strict";

  var GAME = (location.pathname.match(/([^/]+)\.html$/) || [])[1] || "";
  var BOARD_GAMES = ["chess", "checkers", "drop-four", "sea-strike"];
  var IS_BOARD = BOARD_GAMES.indexOf(GAME) !== -1;

  // Per-game key maps. Every game plays on the D-pad, A, B and A+B together —
  // two buttons like an old arcade stick, so an NES pad works as well as the
  // SNES ones (Glen, 2026-09-28). Player 1 = amber (bottom edge), player 2 =
  // cyan (top edge). a / b / ab name the key each press sends; when both are
  // held, ab is sent INSTEAD of a and b if the game has one. bMod re-points the
  // D-pad while B alone is held, for the one game with more to steer.
  var MAPS = {
    "light-racer": {   // A or B boosts
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", a: "Space", b: "Space" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", a: "Enter", b: "Enter" }
    },
    "serpent-duel": {
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }
    },
    "rally": {
      1: { left: "KeyA", right: "KeyD" },
      2: { left: "ArrowLeft", right: "ArrowRight" }
    },
    "twin-siege": {    // A or B fires
      1: { left: "KeyA", right: "KeyD", up: "KeyW", a: "Space", b: "Space" },
      2: { left: "ArrowLeft", right: "ArrowRight", down: "ArrowDown", a: "Enter", b: "Enter" }
    },
    "orbit-duel": {    // A fire, B thrust (as does up), A+B hyperspace
      1: { left: "KeyA", right: "KeyD", up: "KeyW", a: "Space", b: "KeyW", ab: "KeyE" },
      2: { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", a: "Enter", b: "ArrowUp", ab: "ShiftRight" }
    },
    "iron-treads": {   // A or B fires
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", a: "Space", b: "Space" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", a: "Enter", b: "Enter" }
    },
    "star-trek": {     // Tactical: D-pad aims, A phasers, B torpedo, A+B console (1P)
                       // Engineering: D-pad picks an answer, A confirms, B calls the officer
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", a: "Space", b: "KeyQ", ab: "KeyE" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", a: "Enter", b: "ShiftRight" }
    },
    "falcon-gunners": { // D-pad aims, A fires the quad lasers, B a torpedo
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", a: "Space", b: "KeyQ" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", a: "Enter", b: "ShiftRight" }
    },
    "banana-barrage": {
      // D-pad walks (left/right) and sets the angle (up/down). Hold B and the
      // same D-pad aims (left/right) and sets the power (up/down). A throws.
      1: { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", a: "Space",
           bMod: { left: "KeyQ", right: "KeyE", up: "KeyR", down: "KeyF" } },
      2: { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", a: "Enter",
           bMod: { left: "Comma", right: "Period", up: "PageUp", down: "PageDown" } }
    }
  };

  var KEYNAME = {
    Space: " ", Enter: "Enter", Comma: ",", Period: ".",
    PageUp: "PageUp", PageDown: "PageDown",
    ShiftLeft: "Shift", ShiftRight: "Shift",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight"
  };
  function keyFor(c) {
    if (KEYNAME[c]) return KEYNAME[c];
    return c.indexOf("Key") === 0 ? c.slice(3).toLowerCase() : c;
  }

  var heldKeys = {};
  function setKey(code, isDown) {
    if (!code) return;
    if (!!heldKeys[code] === !!isDown) return;        // edge only, no repeats
    heldKeys[code] = isDown;
    if (PADLOG) padlog({ key: code, down: !!isDown });
    document.dispatchEvent(new KeyboardEvent(isDown ? "keydown" : "keyup", {
      code: code, key: keyFor(code), bubbles: true, cancelable: true
    }));
  }
  // A game ending mid-press would otherwise be left believing a key is held.
  function releaseAll() {
    for (var c in heldKeys) if (heldKeys[c]) setKey(c, false);
  }

  // ?padlog=1 sends every raw button change and every key the shim synthesises
  // to the server log, for "this button does the wrong thing" reports that a
  // simulated pad cannot reproduce.
  var PADLOG = /[?&]padlog=1/.test(location.search);
  function padlog(d) {
    d.padlog = GAME;
    try { fetch("/api/shim-log", { method: "POST", headers: { "Content-Type": "application/json" },
                                   body: JSON.stringify(d) }); } catch (e) {}
  }
  var lastRaw = {};
  function logRaw(list) {
    for (var i = 0; i < list.length; i++) {
      var gp = list[i], down = [];
      for (var b = 0; b < gp.buttons.length; b++) if (gp.buttons[b] && gp.buttons[b].pressed) down.push(b);
      var sig = down.join(",") + "|" + Array.prototype.map.call(gp.axes, function (v) { return Math.round(v); }).join(",");
      if (lastRaw[gp.index] !== sig) {
        lastRaw[gp.index] = sig;
        padlog({ pad: gp.index, id: gp.id, nes: isNesPad(gp), buttons: down, axes: sig.split("|")[1] });
      }
    }
  }

  function pads() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [];
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected) out.push(list[i]);
    if (PADLOG) logRaw(out);
    return out;
  }

  // Cheap pads report the D-pad as buttons on some firmwares and as axes on
  // others, so accept either rather than guessing.
  // Button numbering taken from the SAME RetroArch autoconfig these pads
  // already use (iNNEXT SNES Gamepad: B=2 A=1 Y=3 X=0 L=4 R=5 Select=8
  // Start=9), so a button does the same thing in these games as it does in
  // every emulated one. Note the D-pad is on AXES here, not buttons 12-15 —
  // the earlier guess of "buttons 0 or 1 are the action button" was actually
  // X and A.
  var DEAD = 0.5;
  // Some cheap pads — the DragonRise SNES clones this cabinet uses among them —
  // report the D-pad as a HAT on a single high axis rather than as axes 0/1 or
  // as buttons 12-15. Eight directions are encoded as fractions across the
  // axis range, with a value outside [-1,1] (or a resting 0) meaning centred.
  //
  // Missing this is invisible in a game and obvious in a menu: the flippers
  // still work because those are mapped to the shoulders as well, so the pad
  // looks fine right up until you try to move a selection.
  function hatDir(ax) {
    for (var i = 2; i < ax.length; i++) {
      var v = ax[i];
      if (typeof v !== "number" || v < -1.05 || v > 1.05) continue;
      if (Math.abs(v) < 0.2) continue;                  // centred
      var k = Math.round(((v + 1) / 2) * 8) % 8;        // 0=up, clockwise
      return { up: k === 0 || k === 1 || k === 7,
               right: k >= 1 && k <= 3,
               down: k >= 3 && k <= 5,
               left: k >= 5 && k <= 7 };
    }
    return null;
  }

  // The USB NES pads (081f:e401, and 0810:e501 found 2026-09-29) number their buttons differently from the
  // SNES clones: A=1 B=0 Select=8 Start=9, D-pad on axes 0/1 (read off one on
  // Windows 2026-09-28). There is no X or Y, so A and B are the whole game.
  function isNesPad(gp) { return /081f.*e401|0810.*e501/i.test(gp.id || ""); }

  function readPad(gp) {
    if (!gp) return null;
    var b = gp.buttons, ax = gp.axes;
    function pressed(i) { return !!(b[i] && b[i].pressed); }
    var hat = hatDir(ax) || {};
    if (isNesPad(gp)) {
      return {
        up:    (ax[1] || 0) < -DEAD, down:  (ax[1] || 0) > DEAD,
        left:  (ax[0] || 0) < -DEAD, right: (ax[0] || 0) > DEAD,
        a:     pressed(1),
        b:     pressed(0),
        prim:  pressed(0) || pressed(1),   // A or B, as on the SNES pads
        sec:   pressed(0) && pressed(1),   // the third button is A+B together
        y: false, x: false, l: false, r: false,
        select: pressed(8),
        start:  pressed(9)
      };
    }
    return {
      up:     (ax[1] || 0) < -DEAD || pressed(12) || !!hat.up,
      down:   (ax[1] || 0) >  DEAD || pressed(13) || !!hat.down,
      left:   (ax[0] || 0) < -DEAD || pressed(14) || !!hat.left,
      right:  (ax[0] || 0) >  DEAD || pressed(15) || !!hat.right,
      a:      pressed(1) || pressed(0),   // A (X counts too: same side of the pad)
      b:      pressed(2) || pressed(3),   // B (and Y)
      prim:   pressed(2) || pressed(1),   // B or A
      sec:    pressed(3) || pressed(0),   // Y or X, for games wanting one extra
      y:      pressed(3),                 // separately, for games wanting two
      x:      pressed(0),
      l:      pressed(4),
      r:      pressed(5),
      select: pressed(8),
      start:  pressed(9)
    };
  }

  // A game that reads the pads itself (Word Forge) says so with
  // <meta name="table-shim" content="native">. Driving it as well meant every
  // press landed twice and START opened two pause menus on top of each other.
  // Such a game gets the exit combo and nothing else — it has to stay, since a
  // game you cannot leave is a brick on a cabinet with no keyboard.
  var nativeMeta = document.querySelector('meta[name="table-shim"]');
  if (nativeMeta && nativeMeta.content === "native") {
    var nExitHeld = 0, nLeaving = false;
    (function nativeTick() {
      var gs = pads(), want = false;
      for (var i = 0; i < 2; i++) {
        var p = readPad(gs[i]);
        if (p && p.select && p.start) want = true;
      }
      if (want && !nLeaving) {
        if (!nExitHeld) nExitHeld = Date.now();
        if (Date.now() - nExitHeld < 1200) showBanner("BACK TO ARCADE...  RELEASE TO CANCEL");
        else {
          nLeaving = true;
          showBanner("RETURNING TO ARCADE...");
          fetch("/api/exit-table", { method: "POST" })["catch"](function () {});
        }
      } else if (!want) {
        nExitHeld = 0;
        if (banner) banner.hidden = true;
      }
      requestAnimationFrame(nativeTick);
    })();
    return;
  }

  // Virtual cursor. Board games read coordinates off a canvas, so hopping focus
  // between elements cannot work — there are no elements to focus. A cursor
  // dispatching real pointer events is the only input those games accept.
  var cx = window.innerWidth / 2, cy = window.innerHeight / 2, vel = 4, dot = null;
  function cursorEl() {
    if (!dot) {
      dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;z-index:99998;width:26px;height:26px;margin:-13px 0 0 -13px;" +
        "border:3px solid #ff2e63;border-radius:50%;pointer-events:none;" +
        "box-shadow:0 0 10px rgba(255,46,99,.9),inset 0 0 6px rgba(255,46,99,.5)";
      document.body.appendChild(dot);
    }
    return dot;
  }
  // Board games are grids, so the cursor steps square by square instead of
  // gliding. Free movement turns picking a chess square into a mousing
  // exercise, which is exactly the feel we are trying to avoid.
  var GRID = { chess: 8, checkers: 8, "drop-four": 7, "sea-strike": 8 };
  function boardStep(dir) {
    var cv = document.querySelector("canvas");
    var n = GRID[GAME] || 8;
    if (!cv) return false;
    var r = cv.getBoundingClientRect();
    if (r.width < 40) return false;
    var cell = r.width / n;
    // Snap onto the grid first, then move one square.
    var col = Math.round((cx - r.left - cell / 2) / cell);
    var row = Math.round((cy - r.top - cell / 2) / cell);
    var rows = Math.max(1, Math.round(r.height / cell));
    if (dir === "left") col--; else if (dir === "right") col++;
    else if (dir === "up") row--; else if (dir === "down") row++;
    col = Math.max(0, Math.min(n - 1, col));
    row = Math.max(0, Math.min(rows - 1, row));
    cx = r.left + col * cell + cell / 2;
    cy = r.top + row * cell + cell / 2;
    var d = cursorEl();
    d.style.width = d.style.height = Math.round(cell) + "px";
    d.style.margin = Math.round(-cell / 2) + "px 0 0 " + Math.round(-cell / 2) + "px";
    d.style.borderRadius = "4px";
    d.style.left = cx + "px"; d.style.top = cy + "px"; d.hidden = false;
    return true;
  }

  function moveCursor(p) {
    var moving = p.up || p.down || p.left || p.right;
    vel = moving ? Math.min(vel + 0.9, 22) : 4;
    if (p.left) cx -= vel;
    if (p.right) cx += vel;
    if (p.up) cy -= vel;
    if (p.down) cy += vel;
    cx = Math.max(2, Math.min(window.innerWidth - 2, cx));
    cy = Math.max(2, Math.min(window.innerHeight - 2, cy));
    var d = cursorEl();
    d.style.left = cx + "px";
    d.style.top = cy + "px";
    d.hidden = false;
  }
  function clickAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return;
    var o = { bubbles: true, cancelable: true, clientX: x, clientY: y,
              pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 };
    try { el.dispatchEvent(new PointerEvent("pointerdown", o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent("mousedown", o));
    try { el.dispatchEvent(new PointerEvent("pointerup", o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }

  // The games hide #setup once play starts, and ignore keys entirely while it
  // is visible — so that is exactly when the cursor has to drive the buttons.
  // Any screen that is asking you to press a button, not just the start
  // screen. Light Racer's end-of-match panel is <div class="overlay" id="over">
  // — checking only #setup and #rules left REMATCH and MENU unreachable,
  // because the shim stayed in key mode and nothing was clicking them.
  // Visibility by measured box, NOT offsetParent. These panels are
  // .modal{position:fixed}, and offsetParent is null for every fixed-position
  // element whether it is visible or not — so an offsetParent test reported
  // the setup screen as absent and the board cursor was drawn over the top
  // of the menu.
  function shown(el) {
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  }
  function setupVisible() {
    var ids = ["#setup", "#rules", "#over"];
    for (var i = 0; i < ids.length; i++) {
      if (shown(document.querySelector(ids[i]))) return true;
    }
    // Catch-all for the games that name their panels differently.
    var panels = document.querySelectorAll(".overlay, .modal");
    for (var j = 0; j < panels.length; j++) {
      if (shown(panels[j]) && panels[j].querySelector("button")) return true;
    }
    return false;
  }

  // The games draw on-screen LEFT / BOOST / RIGHT buttons for touchscreens.
  // This cabinet has no touchscreen, so they are decoration that eats space
  // and invites people to press glass that does nothing. Hidden rather than
  // deleted, so the games stay unmodified and a touch build still works.
  function hideTouchControls() {
    var pads = document.querySelectorAll(".pad");
    for (var i = 0; i < pads.length; i++) pads[i].style.display = "none";
  }
  window.addEventListener("load", function () { setTimeout(hideTouchControls, 100); });

  // Report what the shim can see, so failures can be diagnosed from the
  // outside instead of guessed at.
  setTimeout(function () {
    var c = document.querySelector(".controls");
    fetch("/api/shim-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: GAME,
        controlsFound: !!c,
        controlsDisplay: c ? (c.style.display || getComputedStyle(c).display) : null,
        controlsCount: c ? c.querySelectorAll("button,a").length : 0,
        pads: (navigator.getGamepads ? navigator.getGamepads() : []).length,
        setupVisible: setupVisible(),
        ver: "diag1"
      })
    })["catch"](function () {});
  }, 3000);


  // ---- menu navigation ----------------------------------------------------
  // Setup screens are real <button> elements, so a controller should move
  // FOCUS between them the way every console menu has since 1990 — not push a
  // mouse pointer around. The pointer is kept only for the board games, where
  // there is genuinely nothing to focus.
  var navIdx = 0;
  // The panel currently on top, so focus stays inside it.
  //
  // Rules opens over setup, and setup opens over the game-over panel, so the
  // order here is the stacking order and not the order they appear in the
  // markup. Without this the focus list was built from the whole document and
  // included the game-over panel sitting behind the setup screen: the
  // selection scrolled down onto NEW MATCH and MENU, which were not on top,
  // could not be clicked, and should never have been offered.
  function activePanel() {
    var ids = ["#rules", "#setup", "#over"];
    for (var i = 0; i < ids.length; i++) {
      var el = document.querySelector(ids[i]);
      if (shown(el)) return el;
    }
    var panels = document.querySelectorAll(".overlay, .modal");
    for (var j = 0; j < panels.length; j++) {
      if (shown(panels[j]) && panels[j].querySelector("button")) return panels[j];
    }
    return null;
  }

  function menuButtons() {
    var root = activePanel() || document;
    var all = root.querySelectorAll("button, a[href]");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.disabled) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;                 // hidden
      if (!shown(el)) continue;
      // Off-screen buttons stay in: a long rules page puts BACK TO GAME below
      // the fold, and skipping it left six games' rules with nothing to press
      // (2026-09-28). Focusing one scrolls it into view.
      // Skip the on-screen touch controls, but NOT everything inside a .pad.
      // The games reuse .pad purely for layout on their game-over panels, so
      // excluding the whole container hid REMATCH and MENU from the focus
      // list — the shim entered menu mode, found nothing selectable, and the
      // panel could not be answered on a pad at all. Every game marks a real
      // touch control with data-hold and a menu action with data-act, so key
      // on that instead of on the container.
      if (el.closest && el.closest(".pad") && el.hasAttribute("data-hold")) continue;
      out.push({ el: el, r: r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    }
    return out;
  }
  function paintFocus(list) {
    for (var i = 0; i < list.length; i++) {
      list[i].el.style.outline = (i === navIdx) ? "4px solid #ff2e63" : "";
      list[i].el.style.outlineOffset = (i === navIdx) ? "2px" : "";
    }
    if (list[navIdx]) {
      var el = list[navIdx].el;
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  }
  // Move to the nearest button in the pressed direction rather than the next
  // in document order: these screens are laid out in rows of segmented
  // choices, and index-order stepping wanders sideways off a row.
  function navMove(list, dir) {
    var cur = list[navIdx];
    if (!cur) { navIdx = 0; return; }
    var best = -1, bestScore = 1e9;
    for (var i = 0; i < list.length; i++) {
      if (i === navIdx) continue;
      var dx = list[i].cx - cur.cx, dy = list[i].cy - cur.cy;
      var along = dir === "left" ? -dx : dir === "right" ? dx
                : dir === "up" ? -dy : dy;
      if (along <= 2) continue;                       // wrong side
      var across = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);
      var score = along + across * 3;                 // prefer straight ahead
      // Sideways should stay inside the row of choices you are on. Without
      // this, moving right from 2 PLAYER TABLE drops into the group below,
      // because that button is physically nearer than the wide one alongside.
      if ((dir === "left" || dir === "right") &&
          list[i].el.parentElement !== cur.el.parentElement) score += 2000;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) navIdx = best;
  }


  // A way out of a setup screen.
  //
  // Every game has a MENU link, but it lives in the .controls row, which is
  // hidden for the whole session — so from a game's own menu there was no way
  // back to the arcade at all without starting a game first and then pausing
  // it. This puts one into whichever panel is showing, styled from the game's
  // own buttons so it belongs there, and the focus list picks it up like any
  // other entry because it carries no data-hold.
  function ensureBackButton() {
    var panel = activePanel();
    var existing = document.getElementById("pz-back");
    // Start screens only (the panel with PRESS START). On Sea Strike's fleet
    // placement it landed among the ships and became the line the cursor
    // stopped on instead of READY; mid-game, EXIT is on the pause menu.
    if (!panel || leaving || !panel.querySelector(".startBtn")) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.parentElement === panel) return;
    if (existing) existing.remove();
    var model = document.querySelector(".controls button, .px");
    var b = model ? model.cloneNode(false) : document.createElement("button");
    b.id = "pz-back";
    b.removeAttribute("data-act");
    b.removeAttribute("data-hold");
    b.textContent = "◀ EXIT TO ARCADE";   // same words as the pause menu
    b.style.display = "block";
    b.style.visibility = "";
    b.style.marginTop = "14px";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      backToPicker();
    });
    // Put it beside the game's own buttons rather than at the root of the
    // panel. The panel is full width and the buttons sit in a narrower column
    // inside it, so appending to the panel made a button that ran off both
    // sides of the layout.
    var host = panel.querySelector(".startBtn") || panel.querySelector(".px");
    var parent = (host && host.parentElement) || panel;
    parent.appendChild(b);
  }
  setInterval(ensureBackButton, 400);

  // ---- pause menu ---------------------------------------------------------
  // Every game keeps its controls in a permanent <div class="controls"> row
  // under the playfield, plus a MOVE LOG. That is a mouse layout: on the board
  // games the cursor is confined to the board grid so the row is unreachable,
  // and on a table it is clutter at somebody's elbow that cannot be used.
  //
  // The row is hidden during play and reopened on Start as an overlay. The
  // entries are CLONES of the game's own buttons, so they inherit the game's
  // CSS and look like the game rather than like a debug list; selecting one
  // clicks the ORIGINAL, which still works even while hidden.
  var paused = false, pauseIdx = 0, pauseEl = null, prevStart = [false, false];
  // "main" = this game's controls. "games" = the table-arcade line-up.
  // Switching between table games is a plain navigation on the same origin:
  // same browser, same portrait rotation, no kiosk restart. Going out to the
  // picker and back costs a rotation flip each way for no reason.
  var pauseView = "main", tableList = null;

  fetch("/api/table-games").then(function (r) { return r.json(); })
    .then(function (d) { tableList = d.games || []; })["catch"](function () {});

  // A synthetic row that still looks like one of the game's own buttons.
  function fakeButton(label) {
    var model = document.querySelector(".controls button, .px");
    var el = model ? model.cloneNode(false) : document.createElement("button");
    el.removeAttribute("id");
    el.removeAttribute("data-act");
    el.textContent = label;
    return el;
  }

  function pauseItems() {
    var PB = window.PINBALL;
    if (pauseView === "tables" && PB && PB.tables) {
      var tr = [{ label: "◀ BACK", act: "back" }];
      for (var ti = 0; ti < PB.tables.length; ti++) {
        tr.push({ label: PB.tables[ti].name + (PB.tables[ti].id === PB.table ? " · PLAYING" : ""),
                  act: "table", id: PB.tables[ti].id });
      }
      return tr;
    }
    if (pauseView === "games") {
      var rows = [{ label: "◀ BACK", act: "back" }];
      var here = (location.pathname.match(/([^/]+\.html)$/) || [])[1];
      for (var i = 0; tableList && i < tableList.length; i++) {
        var g = tableList[i];
        rows.push({
          label: g.title.toUpperCase() + (g.rom === here ? " · PLAYING" : ""),
          act: "play", rom: g.rom
        });
      }
      return rows;
    }
    // One layout for every game, whatever its own control row calls things
    // or whatever order it puts them in (Glen, 2026-09-28: "make it feel like
    // a real arcade"). Built from the game's buttons by id, which all eleven
    // share: bNew, bPause, bTable, bSound, plus a RULES button and MENU link.
    var out = [{ label: "RESUME", act: "resume" }];
    var ctl = controlEls(), extras = [], rules = null;
    for (var j = 0; j < ctl.length; j++) {
      var el = ctl[j], t = (el.textContent || "").trim();
      if (el.tagName === "A" || /^◀?\s*MENU$/i.test(t)) continue;  // EXIT, below
      if (el.id === "bPause") continue;         // a PAUSE entry inside PAUSED
      // Pinball's bTable only steps to the NEXT table; CHOOSE TABLE replaces it.
      if (el.id === "bTable" && PB && PB.tables) continue;
      if (el.id === "bNew") { out.push({ label: "NEW GAME", act: "new", el: el }); continue; }
      if (/^(RULES|HOW TO PLAY)$/i.test(t)) { rules = el; continue; }
      // Settings that flip (TABLE VIEW: ON, SOUND: OFF) stay in the menu so
      // the new value shows; anything else acts on the game and resumes it.
      extras.push({ label: t, act: /:/.test(t) ? "toggle" : "click", el: el });
    }
    out = out.concat(extras);
    if (PB && PB.tables) out.push({ label: "CHOOSE TABLE ▸", act: "tables" });
    if (rules) out.push({ label: "HOW TO PLAY", act: "rules", el: rules });
    out.push({ label: "TABLE ARCADE ▸", act: "switch" });
    out.push({ label: "◀ EXIT TO ARCADE", act: "exit" });
    return out;
  }

  // Injected into <head>, not into the overlay. Styles placed inside the
  // overlay are destroyed the moment drawPause() sets innerHTML — which is
  // exactly what turned the first version into a wall of unstyled text.
  function ensurePauseCss() {
    if (document.getElementById("pz-css")) return;
    var st = document.createElement("style");
    st.id = "pz-css";
    // Its own look, not copies of each game's buttons: the copies brought
    // every game's own size, padding and colour, so the menu was pink in one
    // game, tiny in another and taller than the screen in a third. Modelled on
    // pinball's (bold monospace, bright), sized so every row fits (Glen,
    // 2026-09-29).
    st.textContent =
      "#pz-wrap{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(4,2,12,.90)}" +
      "#pz-box{width:min(92vw,max(620px,34vmax));max-height:94vh;overflow:hidden;padding:1rem 1.4rem;" +
      "border:4px solid #ffd23f;border-radius:10px;background:rgba(12,10,32,.98);display:flex;" +
      "flex-direction:column;gap:var(--pz-gap,10px);font-family:'DejaVu Sans Mono',Consolas,Menlo,monospace;font-weight:700}" +
      "#pz-title{text-align:center;letter-spacing:.14em;color:#fff;font-size:calc(var(--pz-font,24px) * 1.25);margin:.2em 0 .3em}" +
      "#pz-box .pz-item{display:block;width:100%;box-sizing:border-box;text-align:center;color:#fff;" +
      "font-size:var(--pz-font,24px);line-height:1.2;padding:var(--pz-pad,.5em) .5em;background:#1b1650;" +
      "border:3px solid #6b63ff;border-radius:8px;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#pz-box .pz-item.sel{border-color:#ffd23f;color:#ffd23f;background:#3a2fb0;box-shadow:0 0 0 3px #ffd23f}" +
      "#pz-hint{text-align:center;color:#d9d3ff;font-size:max(14px,calc(var(--pz-font,24px) * .6));margin-top:.3em;letter-spacing:.04em}";
    document.head.appendChild(st);
  }

  // The game's own controls: the persistent row and the back-to-menu link.
  // Setup and rules panels are excluded — those are handled by focus nav.
  function controlEls() {
    var out = [];
    var row = document.querySelector(".controls");
    if (row) {
      var b = row.querySelectorAll("button, a[href]");
      for (var i = 0; i < b.length; i++) if (!b[i].disabled) out.push(b[i]);
    }
    var link = document.querySelector("a.menuLink");
    if (link && out.indexOf(link) === -1) out.push(link);
    return out;
  }

  // Hidden during play, not deleted: element.click() still fires on a hidden
  // element, so the pause menu can drive the originals.
  function hideControls(hide) {
    var row = document.querySelector(".controls");
    if (row) row.style.display = hide ? "none" : "";
    var log = document.querySelector("details.log, .log");
    if (log) log.style.display = hide ? "none" : "";
    var link = document.querySelector("a.menuLink");
    if (link) link.style.display = hide ? "none" : "";

    // The on-screen touch pads. A cabinet has a joystick and buttons, so
    // these are dead weight occupying the bottom of the board — on Iron
    // Treads they take a fifth of the playfield for controls nobody can
    // reach under glass.
    //
    // Only the ones holding real touch controls: the games also use .pad
    // purely for layout on their game-over panels, and hiding those would
    // take REMATCH and MENU with them.
    var pads = document.querySelectorAll(".pad, .pads");
    for (var p = 0; p < pads.length; p++) {
      if (!pads[p].querySelector("[data-hold]")) continue;
      pads[p].style.display = hide ? "none" : "";
    }
  }

  function drawPause(items) {
    var box = document.getElementById("pz-box");
    box.innerHTML = "";
    // Size the text so title + every row + hint fit the screen height: about
    // pinball's size for the short menu, smaller for the 14-game list.
    var n = items.length;
    var vmax = Math.max(window.innerWidth, window.innerHeight);
    var font = Math.max(14, Math.min(Math.max(28, vmax * 0.017), (window.innerHeight * 0.82) / (n * 2.45 + 3.2)));
    box.style.setProperty("--pz-font", Math.round(font) + "px");
    box.style.setProperty("--pz-gap", Math.round(font * 0.4) + "px");
    box.style.setProperty("--pz-pad", n > 9 ? ".3em" : ".5em");
    var t = document.createElement("div");
    t.id = "pz-title";
    t.textContent = pauseView === "games" ? "TABLE ARCADE" : pauseView === "tables" ? "PINBALL TABLE" : "PAUSED";
    box.appendChild(t);
    for (var i = 0; i < items.length; i++) {
      var c = document.createElement("div");
      c.className = "pz-item" + (i === pauseIdx ? " sel" : "");
      c.textContent = items[i].label;
      box.appendChild(c);
    }
    var h = document.createElement("div");
    h.id = "pz-hint";
    h.textContent = pauseView === "main" ? "D-PAD MOVE · A SELECT · B OR START RESUME"
                                         : "D-PAD MOVE · A SELECT · B BACK";
    box.appendChild(h);
    var selEl = box.querySelector(".pz-item.sel");
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: "nearest" });
  }

  // One line in the kiosk log per session describing what the pads actually
  // look like: their id, how many buttons and axes, and the live axis values.
  // Pad layout differs between models and the browser remaps some of them, so
  // "the D-pad does not move the menu" is not diagnosable from the outside.
  // Menu actions are logged because the cabinet has no console: "nothing
  // happened when I chose it" has several possible causes — the entry was
  // never reached, the click went to an element nobody wired up, or the whole
  // branch was skipped because the shim thought it was already leaving.
  function logMenu(what, extra) {
    var d = { menu: what, leaving: leaving, paused: paused };
    for (var k in extra) d[k] = extra[k];
    try {
      fetch("/api/shim-log", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d) });
    } catch (e) {}
  }

  // ?padcheck=1 reports what the shim did to this game's on-screen clutter.
  // Eleven games is too many to confirm by eye, and a screenshot of a setup
  // screen does not show what is behind it.
  if (/[?&]padcheck=1/.test(location.search)) {
    setTimeout(function () {
      var pads = document.querySelectorAll(".pad, .pads");
      var touch = 0, hidden = 0, layout = 0;
      for (var i = 0; i < pads.length; i++) {
        if (pads[i].querySelector("[data-hold]")) {
          touch++;
          if (getComputedStyle(pads[i]).display === "none") hidden++;
        } else layout++;
      }
      var row = document.querySelector(".controls");
      fetch("/api/shim-log", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padcheck: GAME, touchPads: touch,
          touchPadsHidden: hidden, layoutPads: layout,
          controlsHidden: !row || getComputedStyle(row).display === "none" }) });
    }, 1800);
  }

  var padsReported = false;
  function reportPads() {
    if (padsReported) return;
    padsReported = true;
    var gs = pads(), d = [];
    for (var i = 0; i < gs.length; i++) {
      if (!gs[i]) continue;
      var down = [];
      for (var b = 0; b < gs[i].buttons.length; b++) {
        if (gs[i].buttons[b].pressed) down.push(b);
      }
      d.push({ id: gs[i].id, mapping: gs[i].mapping,
               buttons: gs[i].buttons.length, axes: gs[i].axes.length,
               axisVals: Array.prototype.slice.call(gs[i].axes).map(function (v) {
                 return Math.round(v * 100) / 100;
               }),
               pressed: down });
    }
    try {
      fetch("/api/shim-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padReport: d, game: GAME })
      });
    } catch (e) {}
  }

  function openPause() {
    reportPads();
    // Re-entry would reset the highlight to the first entry on every frame,
    // which looks exactly like a menu that cannot be moved.
    if (paused) return;
    // The games' own index page has no controls, so a pause menu there is an
    // empty box with nothing to select and no obvious way out. Better to do
    // nothing at all.
    // Briefly un-hide so the clones inherit real computed styling, then hide
    // again before anything is painted.
    hideControls(false);
    if (!controlEls().length) { hideControls(true); return; }
    ensurePauseCss();
    if (!pauseEl) {
      pauseEl = document.createElement("div");
      pauseEl.id = "pz-wrap";
      var box = document.createElement("div");
      box.id = "pz-box";
      pauseEl.appendChild(box);
      document.body.appendChild(pauseEl);
    }
    // No longer takes the game's own colour: in Drop Four that made pink text
    // under a pinkish highlight that could hardly be seen (2026-09-29).
    paused = true;
    pauseView = "main";
    pauseIdx = 0;
    releaseAll();
    if (!IS_BOARD) { setKey("KeyP", true); setKey("KeyP", false); }
    drawPause(pauseItems());
    hideControls(true);
    pauseEl.hidden = false;
  }

  function closePause(resumeGame) {
    paused = false;
    if (pauseEl) pauseEl.hidden = true;
    hideControls(true);         // stay hidden during play
    if (resumeGame && !IS_BOARD) { setKey("KeyP", true); setKey("KeyP", false); }
  }

  // The games' MENU link points at their own index.html. On this cabinet the
  // picker is the menu, and that page has no controller support of its own —
  // landing on it is a dead end. Intercept it wherever it is clicked from.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a.menuLink") : null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    backToPicker();
  }, true);

  function backToPicker() {
    if (leaving) return;
    leaving = true;
    releaseAll();
    if (pauseEl) pauseEl.hidden = true;
    fetch("/api/exit-table", { method: "POST" })["catch"](function () {});
    // On the cabinet that endpoint relaunches the browser at the picker, and
    // resets the display rotation on the way — which is why it is asked first
    // rather than simply navigating. On a desktop nothing is listening for it,
    // so fall back to the picker directly once it is clear nobody answered.
    setTimeout(function () { if (!document.hidden) location.href = "/"; }, 1500);
  }

  // Keep the row hidden from the moment play starts, and let it come back on
  // setup screens where the buttons are the whole interface.
  // Hidden for the whole session, not only during play. Tying this to "is a
  // menu showing" meant the row came back on every GAME OVER — which is a menu
  // state — and that is exactly the clutter it was hidden to remove. Nothing
  // is lost: the setup screens live in their own #setup modal, so PRESS START
  // and friends are untouched, and everything in .controls is on START.
  setInterval(function () {
    if (!paused) hideControls(true);
  }, 400);

  var exitHeld = 0, leaving = false, banner = null;
  function showBanner(t) {
    if (!banner) {
      banner = document.createElement("div");
      banner.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:99999;text-align:center;padding:.6rem;" +
        "background:rgba(0,0,0,.85);color:#ff2e63;font:16px monospace;letter-spacing:.1em";
      document.body.appendChild(banner);
    }
    banner.textContent = t;
    banner.hidden = false;
  }

  var prevPrim = [false, false], prevA = [false, false], prevB = [false, false];
  var reopenAfterRules = false;
  var primLock = [false, false];
  var navHeld = false;

  // ---- line-by-line menus -------------------------------------------------
  // Every panel (setup screen, rules, game over, Sea Strike's hand-over and
  // fleet placement) is read as a stack of LINES, top to bottom:
  //   group  a line of choices ([data-group]): left/right changes the choice
  //   btns   buttons side by side: left/right moves along, A presses
  //   grid   Sea Strike's placement grid: the D-pad moves a square cursor
  // Up/down always goes to the next line, so none can be skipped. The old
  // nearest-button-in-that-direction rule jumped over Sea Strike's CPU LEVEL,
  // whose three narrow buttons sat further off-line than the row below it
  // (Glen, 2026-09-29: "each line of choosing should be a level").
  var menuLine = new WeakMap(), menuCol = 0, menuCell = { r: 0, c: 0 }, lastPanel = null;

  function menuLines(panel) {
    var btns = menuButtons().map(function (b) { return b.el; });
    var items = [], groups = [];
    for (var i = 0; i < btns.length; i++) {
      var el = btns[i], g = el.closest("[data-group]");
      if (g && panel.contains(g)) {
        if (groups.indexOf(g) === -1) {
          groups.push(g);
          var gb = Array.prototype.filter.call(g.querySelectorAll("button"), function (x) {
            return !x.disabled && shown(x);
          });
          items.push({ kind: "group", el: g, box: g.closest(".grp") || g, btns: gb });
        }
      } else {
        items.push({ kind: "btn", el: el });
      }
    }
    var grid = panel.querySelector("canvas.grid");
    if (grid && shown(grid)) items.push({ kind: "grid", el: grid });
    for (var k = 0; k < items.length; k++) {
      var r = (items[k].box || items[k].el).getBoundingClientRect();
      items[k].top = r.top; items[k].cx = r.left + r.width / 2; items[k].h = r.height;
    }
    items.sort(function (x, y) { return (x.top - y.top) || (x.cx - y.cx); });
    var lines = [];
    for (var m = 0; m < items.length; m++) {
      var it = items[m], last = lines[lines.length - 1];
      if (it.kind === "btn" && last && last.kind === "btns" &&
          Math.abs(it.top - last.top) < Math.max(8, it.h * 0.5)) {
        last.btns.push(it.el);
      } else if (it.kind === "btn") {
        lines.push({ kind: "btns", btns: [it.el], top: it.top });
      } else {
        lines.push(it);
      }
    }
    for (var n = 0; n < lines.length; n++) {
      if (lines[n].kind === "btns") {
        lines[n].btns.sort(function (x, y) {
          return x.getBoundingClientRect().left - y.getBoundingClientRect().left;
        });
      }
    }
    return lines;
  }

  function centreX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }

  function cellEl() {
    var c = document.getElementById("pz-cell");
    if (!c) {
      c = document.createElement("div");
      c.id = "pz-cell";
      c.style.cssText = "position:fixed;pointer-events:none;z-index:99998;border:4px solid #ffd23f;" +
        "box-shadow:0 0 0 2px #000,0 0 14px #ffd23f;border-radius:4px;box-sizing:border-box";
      document.body.appendChild(c);
    }
    return c;
  }
  function hideCell() { var c = document.getElementById("pz-cell"); if (c) c.hidden = true; }
  // The grid canvas has a label row and column, so 11 x 11 squares with the
  // playable 10 x 10 starting at (1,1). Points are in screen space: when the
  // box is turned for the far player the game flips them itself.
  function cellPoint(grid, cell) {
    cell = cell || menuCell;
    var r = grid.getBoundingClientRect(), cw = r.width / 11, ch = r.height / 11;
    return { x: r.left + (cell.c + 1.5) * cw, y: r.top + (cell.r + 1.5) * ch,
             l: r.left + (cell.c + 1) * cw, t: r.top + (cell.r + 1) * ch, w: cw, h: ch };
  }
  function pointAt(grid, type, cell) {
    var p = cellPoint(grid, cell);
    grid.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true,
      cancelable: true, pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0 }));
  }

  // Sea Strike, firing. It has two boards and fires on whichever target grid
  // is live (.gridWrap.active); the generic board cursor sat on the top board
  // (your own waters, where a shot does nothing), could not reach the live
  // one, and as a fixed-position dot drifted off the squares when the page
  // scrolled (Glen, 2026-09-30). Same yellow square as fleet placement,
  // re-measured every frame; A fires. The live grid is scrolled into view
  // when the turn passes, for screens shorter than both boards.
  var seaCell = { r: 4, c: 4 }, seaWrap = null;
  function seaTick(p1, p2) {
    var wrap = document.querySelector(".gridWrap.active");
    var grid = wrap && wrap.querySelector("canvas.grid");
    if (!grid || !shown(grid)) { hideCell(); seaWrap = null; return; }
    if (wrap !== seaWrap) {
      seaWrap = wrap;
      if (wrap.scrollIntoView) wrap.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // The CPU's turn: the live grid is your own waters, taking its shot. No
    // cursor there; it read as yours (Glen, 2026-09-30).
    if (wrap.classList.contains("cpu")) { hideCell(); return; }
    // The far player's board is turned to face them, so their pad reads flipped.
    var flip = wrap.classList.contains("flip");
    var dir = null;
    [p1, p2].forEach(function (p) {
      if (!p || dir) return;
      if (p.up) dir = "up"; else if (p.down) dir = "down";
      else if (p.left) dir = "left"; else if (p.right) dir = "right";
    });
    if (dir && flip) dir = { up: "down", down: "up", left: "right", right: "left" }[dir];
    if (dir && !navHeld) {
      navHeld = true;
      if (dir === "up") seaCell.r = Math.max(0, seaCell.r - 1);
      if (dir === "down") seaCell.r = Math.min(9, seaCell.r + 1);
      if (dir === "left") seaCell.c = Math.max(0, seaCell.c - 1);
      if (dir === "right") seaCell.c = Math.min(9, seaCell.c + 1);
      pointAt(grid, "pointermove", seaCell);
    }
    if (!dir) navHeld = false;
    var cp = cellPoint(grid, seaCell), ce = cellEl();
    ce.hidden = false;
    ce.style.left = cp.l + "px"; ce.style.top = cp.t + "px";
    ce.style.width = cp.w + "px"; ce.style.height = cp.h + "px";
    for (var pi = 0; pi < 2; pi++) {
      var pq = pi === 0 ? p1 : p2;
      if (!pq) continue;
      if (pq.a && !prevA[pi] && !primLock[pi]) { primLock[pi] = true; pointAt(grid, "pointerdown", seaCell); }
      prevA[pi] = pq.a; prevB[pi] = pq.b; prevPrim[pi] = pq.prim;
    }
  }

  function menuTick(p1, p2) {
    var panel = activePanel();
    if (!panel) { hideCell(); return; }
    var lines = menuLines(panel);
    if (!lines.length) { hideCell(); return; }
    var li = menuLine.has(panel) ? menuLine.get(panel) : 0;
    if (panel !== lastPanel) { menuCol = 0; lastPanel = panel; }
    if (li >= lines.length) li = lines.length - 1;
    var line = lines[li];

    // A panel turned to face the far player reads upside down to the pad.
    var flip = panel.classList.contains("flip") || !!panel.querySelector(".box.flip, .sheet.flip");
    var dir = null;
    [p1, p2].forEach(function (p) {
      if (!p || dir) return;
      if (p.up) dir = "up"; else if (p.down) dir = "down";
      else if (p.left) dir = "left"; else if (p.right) dir = "right";
    });
    if (dir && flip) dir = { up: "down", down: "up", left: "right", right: "left" }[dir];

    if (dir && !navHeld) {
      navHeld = true;
      var fromX = line.kind === "btns" ? centreX(line.btns[Math.min(menuCol, line.btns.length - 1)]) : null;
      if (line.kind === "grid" && (dir === "left" || dir === "right" ||
          (dir === "up" && menuCell.r > 0) || (dir === "down" && menuCell.r < 9))) {
        if (dir === "left") menuCell.c = Math.max(0, menuCell.c - 1);
        if (dir === "right") menuCell.c = Math.min(9, menuCell.c + 1);
        if (dir === "up") menuCell.r--;
        if (dir === "down") menuCell.r++;
        pointAt(line.el, "pointermove");
      } else if (dir === "up" || dir === "down") {
        var ni = Math.max(0, Math.min(lines.length - 1, li + (dir === "down" ? 1 : -1)));
        if (ni !== li) {
          li = ni; line = lines[li];
          if (line.kind === "btns") {
            // Land on the button nearest where you came from.
            var best = 0, bd = 1e9;
            for (var q = 0; q < line.btns.length; q++) {
              var d = fromX == null ? q : Math.abs(centreX(line.btns[q]) - fromX);
              if (d < bd) { bd = d; best = q; }
            }
            menuCol = best;
          }
          if (line.kind === "grid") { menuCell.r = dir === "down" ? 0 : 9; pointAt(line.el, "pointermove"); }
        }
      } else if (line.kind === "group") {
        var cur = -1;
        for (var g = 0; g < line.btns.length; g++) {
          if (line.btns[g].getAttribute("aria-pressed") === "true") cur = g;
        }
        var nx = Math.max(0, Math.min(line.btns.length - 1, cur + (dir === "right" ? 1 : -1)));
        if (nx !== cur && line.btns[nx]) line.btns[nx].click();
      } else if (line.kind === "btns") {
        menuCol = Math.max(0, Math.min(line.btns.length - 1, menuCol + (dir === "right" ? 1 : -1)));
      }
    }
    if (!dir) navHeld = false;
    menuLine.set(panel, li);
    if (line.kind === "btns" && menuCol >= line.btns.length) menuCol = line.btns.length - 1;

    // Paint: the whole line for choices, the button for buttons, a square on
    // the grid.
    var old = document.querySelectorAll(".cab-focus");
    for (var o = 0; o < old.length; o++) old[o].classList.remove("cab-focus");
    var target = line.kind === "group" ? line.box : line.kind === "btns" ? line.btns[menuCol] : null;
    if (target) {
      target.classList.add("cab-focus");
      if (target.scrollIntoView) target.scrollIntoView({ block: "nearest" });
      hideCell();
    } else if (line.kind === "grid") {
      var cp = cellPoint(line.el), ce = cellEl();
      ce.hidden = false;
      ce.style.left = cp.l + "px"; ce.style.top = cp.t + "px";
      ce.style.width = cp.w + "px"; ce.style.height = cp.h + "px";
    }

    for (var pi = 0; pi < 2; pi++) {
      var pq = pi === 0 ? p1 : p2;
      if (!pq) continue;
      if (pq.a && !prevA[pi]) {
        primLock[pi] = true;
        if (line.kind === "btns") line.btns[menuCol].click();
        else if (line.kind === "grid") pointAt(line.el, "pointerdown");
      } else if (pq.b && !pq.a && !prevB[pi]) {
        primLock[pi] = true;
        var rot = line.kind === "grid" && document.getElementById("bRotate");
        if (rot) { rot.click(); pointAt(line.el, "pointermove"); }
        else {
          // B backs out of a panel that has a way back (the rules' BACK TO
          // GAME) and does nothing elsewhere, so a stray B on a setup screen
          // cannot throw anyone out of the game.
          var all = panel.querySelectorAll("button");
          for (var bk = 0; bk < all.length; bk++) {
            if (/^(BACK TO GAME|BACK|CLOSE|DONE|GOT IT|OK)$/i.test((all[bk].textContent || "").trim()) && shown(all[bk])) {
              all[bk].click();
              break;
            }
          }
        }
      }
      prevA[pi] = pq.a; prevB[pi] = pq.b; prevPrim[pi] = pq.prim;
    }
  }

  function tick() {
    var gs = pads();
    var p1 = readPad(gs[0]), p2 = readPad(gs[1]);
    // Clear the menu carry-over the moment the button is genuinely up.
    if (!p1 || !p1.prim) primLock[0] = false;
    if (!p2 || !p2.prim) primLock[1] = false;

    // Exit is checked first so it always works, including mid-game with keys
    // held. On a cabinet with no keyboard, a game you cannot leave is a brick.
    var wantExit = (p1 && p1.select && p1.start) || (p2 && p2.select && p2.start);
    if (wantExit && !leaving) {
      if (!exitHeld) exitHeld = Date.now();
      if (Date.now() - exitHeld < 1200) {
        showBanner("BACK TO ARCADE...  RELEASE TO CANCEL");
      } else {
        leaving = true;
        releaseAll();
        showBanner("RETURNING TO ARCADE...");
        fetch("/api/exit-table", { method: "POST" })["catch"](function () {});
      }
    } else if (!wantExit) {
      exitHeld = 0;
      if (banner) banner.hidden = true;
    }

    // Start alone toggles pause. Select+Start is the exit combo, so a Start
    // press with Select held must not also open the menu on the way out.
    for (var sp = 0; sp < 2; sp++) {
      var pd = sp === 0 ? p1 : p2;
      if (!pd) continue;
      if (pd.start && !pd.select && !prevStart[sp] && !leaving) {
        paused ? closePause(true) : openPause();
      }
      prevStart[sp] = pd.start;
    }

    if (paused && !leaving) {
      var btns = pauseItems();
      // Up/down is the natural motion, but left/right and the shoulder buttons
      // move the selection too. A menu is the one place where being unable to
      // read one input means being unable to leave, so every plausible control
      // is accepted rather than the correct one.
      // Up/down only, plus the shoulders. Left/right was aliased here as a
      // hedge against an unreadable D-pad, and it backfired: in pinball the
      // flippers ARE left and right on the D-pad, so holding a flipper walked
      // the selection on its own. The pad report shows the D-pad reporting
      // cleanly on the axes, so the hedge was never needed.
      var pdir = null;
      [p1, p2].forEach(function (p) {
        if (!p || pdir) return;
        if (p.up || p.l) pdir = "up";
        else if (p.down || p.r) pdir = "down";
      });
      if (pdir && !navHeld) {
        pauseIdx = pdir === "up"
          ? (pauseIdx - 1 + btns.length) % btns.length
          : (pauseIdx + 1) % btns.length;
        drawPause(pauseItems());
        navHeld = true;
      }
      if (!pdir) navHeld = false;
      for (var pk = 0; pk < 2; pk++) {
        var pv = pk === 0 ? p1 : p2;
        if (!pv) continue;
        var aEdge = pv.a && !prevA[pk], bEdge = pv.b && !pv.a && !prevB[pk];
        prevA[pk] = pv.a; prevB[pk] = pv.b;
        prevPrim[pk] = pv.prim;
        // B backs out: to the main list from the games list, else back to play.
        if (bEdge) {
          if (pauseView !== "main") { pauseView = "main"; pauseIdx = 0; drawPause(pauseItems()); }
          else { primLock[pk] = true; closePause(true); }
          break;
        }
        if (!aEdge) continue;
        var it = btns[pauseIdx];
        if (!it) continue;
        logMenu("select", { idx: pauseIdx, act: it.act, label: it.label,
                            items: btns.length, view: pauseView,
                            hasEl: !!it.el, tableGames: tableList ? tableList.length : -1 });
        // The A that chose an entry is still down when play resumes; without
        // the lock the game reads it as its first action.
        primLock[pk] = true;
        if (it.act === "switch") { pauseView = "games"; pauseIdx = 0; drawPause(pauseItems()); break; }
        if (it.act === "back")   { pauseView = "main";  pauseIdx = 0; drawPause(pauseItems()); break; }
        if (it.act === "tables") { pauseView = "tables"; pauseIdx = 0; drawPause(pauseItems()); break; }
        if (it.act === "table") {
          releaseAll();
          try { localStorage.setItem("pinball.table", it.id); } catch (e) {}
          location.search = "?table=" + it.id;
          break;
        }
        if (it.act === "play") {
          // Same origin, same rotation, same browser — just go there.
          releaseAll();
          location.href = "/table/games/" + it.rom;
          break;
        }
        if (it.act === "resume") { closePause(true); break; }
        if (it.act === "exit")   { closePause(false); backToPicker(); break; }
        if (it.act === "toggle") {
          // Used to close the menu and leave the game paused underneath: a
          // frozen board and no menu, which read as the table being stuck.
          it.el.click();
          drawPause(pauseItems());
          break;
        }
        if (it.act === "rules") {
          // The rules panel opens over the still-paused game; when it closes,
          // the pause menu comes back rather than a frozen board.
          closePause(false);
          reopenAfterRules = true;
          it.el.click();
          break;
        }
        if (it.act === "click") { it.el.click(); closePause(true); break; }
        // NEW GAME: the game's own button, which opens its setup screen.
        closePause(false);
        it.el.click();
        break;
      }
      requestAnimationFrame(tick);
      return;
    }

    // Rules gone but another panel up (Sea Strike's hand-over screen): that
    // panel is where the player is, so stay there and forget the reopen, or
    // the menu would pop up later out of nowhere.
    if (reopenAfterRules && !shown(document.querySelector("#rules")) && setupVisible()) {
      reopenAfterRules = false;
    }
    if (reopenAfterRules && !leaving) {
      if (!setupVisible()) {
        // Straight back to the menu, without the KeyP that openPause() sends:
        // the game is still paused from before, and another KeyP would
        // unpause it behind the menu.
        reopenAfterRules = false;
        hideControls(false);
        paused = true; pauseView = "main"; pauseIdx = 0;
        drawPause(pauseItems());
        hideControls(true);
        pauseEl.hidden = false;
        requestAnimationFrame(tick);
        return;
      }
    }

    if (!leaving) {
      var onMenu = setupVisible();
      if (onMenu) {
        // Menus: line by line, the way Word Forge's own setup screen works.
        releaseAll();
        if (dot) dot.hidden = true;
        menuTick(p1, p2);
      } else if (GAME === "sea-strike") {
        releaseAll();
        if (dot) dot.hidden = true;
        seaTick(p1, p2);
      } else if (IS_BOARD) {
        hideCell();
        // Boards: a cursor is unavoidable (the board is a canvas), but it
        // steps square to square rather than gliding like a mouse.
        releaseAll();
        var bp = p1 || p2;
        var bdir = null;
        [p1, p2].forEach(function (p) {
          if (!p || bdir) return;
          if (p.up) bdir = "up"; else if (p.down) bdir = "down";
          else if (p.left) bdir = "left"; else if (p.right) bdir = "right";
        });
        if (bdir && !navHeld) { if (!boardStep(bdir)) moveCursor(bp); navHeld = true; }
        if (!bdir) navHeld = false;
        if (dot) dot.hidden = false;
        var both2 = [p1, p2];
        for (var z = 0; z < 2; z++) {
          var pz = both2[z];
          if (!pz) continue;
          if (pz.prim && !prevPrim[z]) clickAt(cx, cy);
          prevPrim[z] = pz.prim;
        }
      } else {
        if (dot) dot.hidden = true;
        var map = MAPS[GAME];
        if (map) {
          // Worked out as a whole first: two presses can name the same key
          // (A and B both fire), and setting it per press would let the
          // released one cancel the held one.
          var want = {};
          function hold(code, on) { if (code) want[code] = want[code] || !!on; }
          var players = [[1, p1], [2, p2]];
          for (var j = 0; j < players.length; j++) {
            var n = players[j][0], pp = players[j][1], m = map[n];
            if (!m) continue;
            var dirs = ["up", "down", "left", "right"];
            if (!pp) {
              for (var d0 = 0; d0 < 4; d0++) hold(m[dirs[d0]], false);
              hold(m.a, false); hold(m.b, false); hold(m.ab, false);
              if (m.bMod) for (var d1 = 0; d1 < 4; d1++) hold(m.bMod[dirs[d1]], false);
              continue;
            }
            // The button that dismissed the setup screen is usually still
            // held when play begins, and it is the same button the game reads
            // as its action — so the banana was thrown the instant the game
            // started. Held over from the menu, it counts as released until
            // the player actually lets go.
            var pa = pp.a && !primLock[j], pb = pp.b && !primLock[j];
            var both = pa && pb && !!m.ab;
            var shifted = !!m.bMod && pb && !pa;
            for (var d = 0; d < 4; d++) {
              var dn = dirs[d];
              hold(m[dn], pp[dn] && !shifted);
              if (m.bMod) hold(m.bMod[dn], pp[dn] && shifted);
            }
            hold(m.a, pa && !both);
            hold(m.b, pb && !both && !m.bMod);
            hold(m.ab, both);
          }
          for (var code in want) setKey(code, want[code]);
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Every game wraps itself in .cab with max-width 600-640px, which on a
  // 1080-wide portrait panel uses barely half the screen.
  //
  // Scaled with a CSS transform rather than by raising max-width, deliberately:
  // widening the container makes the CANVAS 1080 wide, nearly three times the
  // pixels computed per frame in JS, which the games' own README warns against
  // on a Pi 4. A transform is composited by the GPU and costs nothing.
  function fitToScreen() {
    var cab = document.querySelector(".cab");
    if (!cab) return;
    cab.style.transform = "none";
    var w = cab.offsetWidth, h = cab.offsetHeight;
    if (!w || !h) return;
    var s = Math.min((window.innerWidth - 8) / w, (window.innerHeight - 8) / h);
    if (s <= 1.01) return;
    cab.style.transformOrigin = "top center";
    cab.style.transform = "scale(" + s.toFixed(3) + ")";
    // The scaled box still occupies its ORIGINAL height in layout, so without
    // this the page scrolls and the far player's panel sits off-screen.
    cab.style.marginBottom = (h * (s - 1)) + "px";
    document.documentElement.style.overflow = "hidden";
  }
  window.addEventListener("load", function () { setTimeout(fitToScreen, 120); });
  window.addEventListener("resize", function () { setTimeout(fitToScreen, 120); });
  new MutationObserver(function () {
    clearTimeout(window.__fitT);
    window.__fitT = setTimeout(fitToScreen, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
