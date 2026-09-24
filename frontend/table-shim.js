// Injected into every table-arcade page by the backend.
//
// These games were written for a keyboard and a pointer. The cabinet has
// neither — two USB gamepads and nothing else — so this layer exists to bridge
// that. It is deliberately NOT part of the games themselves: they stay
// untouched and portable, and everything cabinet-specific lives here.
//
// v1 does the one thing that is non-negotiable: a way back out. Without it a
// game is a dead end on a machine with no keyboard, which is worse than not
// installing the games at all.
(function () {
  const SELECT = 8, START = 9;
  const HOLD_MS = 1200;
  let heldSince = 0;
  let leaving = false;
  let banner = null;

  function showBanner(text) {
    if (!banner) {
      banner = document.createElement("div");
      banner.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:99999;text-align:center;" +
        "padding:.6rem;background:rgba(0,0,0,.85);color:#ff2e63;" +
        "font:16px monospace;letter-spacing:.1em";
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.hidden = false;
  }
  function hideBanner() { if (banner) banner.hidden = true; }


  // ---- Fill the panel -------------------------------------------------
  // Every game wraps itself in .cab with max-width 600-640px, which on a
  // 1080-wide portrait panel uses barely half the screen.
  //
  // Scaled with a CSS transform rather than by raising max-width, on purpose.
  // Widening the container makes the canvas itself bigger — 1080 wide is ~2.8x
  // the pixels of 640, computed in JS every frame, and the games' own README
  // warns against exactly that on a Pi 4. A transform is composited by the GPU,
  // so the canvas keeps its native size and the cost is nil.
  function fitToScreen() {
    const cab = document.querySelector(".cab");
    if (!cab) return;
    cab.style.transform = "none";           // measure unscaled
    const w = cab.offsetWidth, h = cab.offsetHeight;
    if (!w || !h) return;
    const pad = 8;
    const s = Math.min((innerWidth - pad) / w, (innerHeight - pad) / h);
    if (s <= 1.01) return;                  // already filling; leave it alone
    cab.style.transformOrigin = "top center";
    cab.style.transform = "scale(" + s.toFixed(3) + ")";
    // The scaled box still occupies its ORIGINAL height in layout, so without
    // this the page scrolls and the bottom player's panel sits off-screen.
    cab.style.marginBottom = (h * (s - 1)) + "px";
    document.documentElement.style.overflow = "hidden";
  }
  addEventListener("load", () => setTimeout(fitToScreen, 120));
  addEventListener("resize", () => setTimeout(fitToScreen, 120));
  // Start screens swap in different content; re-fit when the tree changes.
  new MutationObserver(() => {
    clearTimeout(window.__fitT);
    window.__fitT = setTimeout(fitToScreen, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    if (leaving) return;
    const pads = Array.from(navigator.getGamepads?.() || []).filter(p => p && p.connected);
    const held = pads.some(p => p.buttons[SELECT]?.pressed && p.buttons[START]?.pressed);
    if (!held) { heldSince = 0; hideBanner(); return; }
    const now = Date.now();
    if (!heldSince) heldSince = now;
    const left = HOLD_MS - (now - heldSince);
    if (left > 0) { showBanner(`BACK TO ARCADE IN ${Math.ceil(left / 1000)}...  RELEASE TO CANCEL`); return; }
    leaving = true;
    showBanner("RETURNING TO ARCADE...");
    fetch("/api/exit-table", { method: "POST" }).catch(() => {});
  }, 100);
})();
