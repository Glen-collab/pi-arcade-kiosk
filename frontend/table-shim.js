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

  // Per-game key maps, transcribed from the project's own README.
  // Player 1 = amber (bottom edge), player 2 = cyan (top edge).
  // prim = A button, sec = B button, l/r = shoulders where a game needs more.
  var MAPS = {
    "light-racer": {
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", prim: "Space" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", prim: "Enter" }
    },
    "serpent-duel": {
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }
    },
    "rally": {
      1: { left: "KeyA", right: "KeyD" },
      2: { left: "ArrowLeft", right: "ArrowRight" }
    },
    "twin-siege": {
      1: { left: "KeyA", right: "KeyD", up: "KeyW", prim: "Space" },
      2: { left: "ArrowLeft", right: "ArrowRight", down: "ArrowDown", prim: "Enter" }
    },
    "orbit-duel": {
      1: { left: "KeyA", right: "KeyD", up: "KeyW", prim: "Space", sec: "KeyE" },
      2: { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", prim: "Enter", sec: "ShiftRight" }
    },
    "iron-treads": {
      1: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", prim: "Space" },
      2: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", prim: "Enter" }
    },
    "banana-barrage": {
      1: { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS",
           prim: "Space", sec: "KeyQ", l: "KeyR", r: "KeyF" },
      2: { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
           prim: "Enter", sec: "Comma", l: "PageUp", r: "PageDown" }
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
    document.dispatchEvent(new KeyboardEvent(isDown ? "keydown" : "keyup", {
      code: code, key: keyFor(code), bubbles: true, cancelable: true
    }));
  }
  // A game ending mid-press would otherwise be left believing a key is held.
  function releaseAll() {
    for (var c in heldKeys) if (heldKeys[c]) setKey(c, false);
  }

  function pads() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [];
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected) out.push(list[i]);
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
  function readPad(gp) {
    if (!gp) return null;
    var b = gp.buttons, ax = gp.axes;
    function pressed(i) { return !!(b[i] && b[i].pressed); }
    return {
      up:     (ax[1] || 0) < -DEAD || pressed(12),
      down:   (ax[1] || 0) >  DEAD || pressed(13),
      left:   (ax[0] || 0) < -DEAD || pressed(14),
      right:  (ax[0] || 0) >  DEAD || pressed(15),
      prim:   pressed(2) || pressed(1),   // B or A
      sec:    pressed(3) || pressed(0),   // Y or X
      l:      pressed(4),
      r:      pressed(5),
      select: pressed(8),
      start:  pressed(9)
    };
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


  // ---- menu navigation ----------------------------------------------------
  // Setup screens are real <button> elements, so a controller should move
  // FOCUS between them the way every console menu has since 1990 — not push a
  // mouse pointer around. The pointer is kept only for the board games, where
  // there is genuinely nothing to focus.
  var navIdx = 0;
  function menuButtons() {
    var all = document.querySelectorAll("button, a[href]");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.disabled) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;                 // hidden
      if (!shown(el)) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;  // off-screen
      if (el.closest && el.closest(".pad")) continue;            // touch-only
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
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) navIdx = best;
  }

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

  var prevPrim = [false, false];
  var navHeld = false;

  function tick() {
    var gs = pads();
    var p1 = readPad(gs[0]), p2 = readPad(gs[1]);

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

    if (!leaving) {
      var onMenu = setupVisible();
      if (onMenu) {
        // Menus: move focus between buttons. No pointer.
        releaseAll();
        if (dot) dot.hidden = true;
        var list = menuButtons();
        if (list.length) {
          if (navIdx >= list.length) navIdx = 0;
          var drv = p1 || p2, alt = p2;
          var dir = null;
          [drv, alt].forEach(function (p) {
            if (!p || dir) return;
            if (p.up) dir = "up"; else if (p.down) dir = "down";
            else if (p.left) dir = "left"; else if (p.right) dir = "right";
          });
          if (dir && !navHeld) { navMove(list, dir); navHeld = true; }
          if (!dir) navHeld = false;
          paintFocus(list);
          var both1 = [p1, p2];
          for (var q = 0; q < 2; q++) {
            var pq = both1[q];
            if (!pq) continue;
            if (pq.prim && !prevPrim[q] && list[navIdx]) list[navIdx].el.click();
            prevPrim[q] = pq.prim;
          }
        }
      } else if (IS_BOARD) {
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
          var players = [[1, p1], [2, p2]];
          for (var j = 0; j < players.length; j++) {
            var n = players[j][0], pp = players[j][1], m = map[n];
            if (!m || !pp) continue;
            setKey(m.up, pp.up);
            setKey(m.down, pp.down);
            setKey(m.left, pp.left);
            setKey(m.right, pp.right);
            setKey(m.prim, pp.prim);
            setKey(m.sec, pp.sec);
            setKey(m.l, pp.l);
            setKey(m.r, pp.r);
          }
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
