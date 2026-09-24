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
  var DEAD = 0.5;
  function readPad(gp) {
    if (!gp) return null;
    var b = gp.buttons, ax = gp.axes;
    function pressed(i) { return !!(b[i] && b[i].pressed); }
    return {
      up:     pressed(12) || (ax[1] || 0) < -DEAD,
      down:   pressed(13) || (ax[1] || 0) >  DEAD,
      left:   pressed(14) || (ax[0] || 0) < -DEAD,
      right:  pressed(15) || (ax[0] || 0) >  DEAD,
      prim:   pressed(0) || pressed(1),
      sec:    pressed(2) || pressed(3),
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
  function moveCursor(p) {
    var moving = p.up || p.down || p.left || p.right;
    // Accelerate while held: precise enough to pick a square, quick enough to
    // cross a board without the player giving up.
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
  function setupVisible() {
    var s = document.querySelector("#setup");
    if (s && !s.hidden) return true;
    var r = document.querySelector("#rules");
    return !!(r && !r.hidden);
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
      var cursorMode = IS_BOARD || setupVisible();
      if (cursorMode) {
        releaseAll();                       // never hold keys while pointing
        var drv = (p1 && (p1.up || p1.down || p1.left || p1.right)) ? p1 : (p2 || p1);
        if (drv) moveCursor(drv);
        var both = [p1, p2];
        for (var i = 0; i < 2; i++) {
          var p = both[i];
          if (!p) continue;
          if (p.prim && !prevPrim[i]) clickAt(cx, cy);
          prevPrim[i] = p.prim;
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
