// effects.js
// Premium interaction taste, reimplemented in vanilla and kept on metaphor.
// Techniques borrowed from Motion (spring feel, inView), React Bits (decrypted
// text, tilt, click spark) and Aceternity (cursor light), but rebuilt in the
// paper-and-ink language: no neon, no glassmorphism, one green accent held to
// its meaning. Everything animates transform and opacity only and degrades to
// calm under prefers-reduced-motion.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------------------------------------------------------------------------
// Decrypted text. Characters resolve from random glyphs into the final string,
// left to right, like a dot-matrix printer settling a toll ticket. On metaphor
// for monospace data: tx hashes, amounts, serial numbers.
// ---------------------------------------------------------------------------

const HEX = "0123456789abcdef";
const ALNUM = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function decryptText(el, finalText, opts = {}) {
  if (!el) return;
  const text = String(finalText);
  if (reduced.matches) {
    el.textContent = text;
    return;
  }
  const charset = opts.charset === "hex" ? HEX : ALNUM;
  const duration = opts.duration ?? 520;
  const settleEvery = duration / Math.max(text.length, 1);
  const start = performance.now();

  const scrambleChar = () => charset[(Math.random() * charset.length) | 0];

  function frame(now) {
    const elapsed = now - start;
    const settled = Math.floor(elapsed / settleEvery);
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      // Whitespace and punctuation lock immediately; they are not "printed".
      if (i < settled || c === " " || c === "." || c === "…" || c === "x") {
        out += c;
      } else {
        out += scrambleChar();
      }
    }
    el.textContent = out;
    if (settled < text.length) requestAnimationFrame(frame);
    else el.textContent = text;
  }
  requestAnimationFrame(frame);
}

// Decrypt every element carrying data-decrypt, once. Used for the static
// specimen ticket on load.
export function decryptOnLoad(root = document) {
  for (const el of root.querySelectorAll("[data-decrypt]")) {
    const final = el.getAttribute("data-decrypt") || el.textContent;
    const charset = el.getAttribute("data-charset") === "hex" ? "hex" : "alnum";
    decryptText(el, final, { charset, duration: 700 });
  }
}

// ---------------------------------------------------------------------------
// Pointer tilt. A card leans toward the cursor in 3D, then springs back. Used
// on the specimen ticket: you pick it up off the desk to read it.
// ---------------------------------------------------------------------------

export function setupTilt(el, opts = {}) {
  if (!el || reduced.matches) return;
  const max = opts.max ?? 7;
  const baseRotate = opts.baseRotate ?? 0;
  let raf = 0;
  let rx = 0;
  let ry = 0;

  function apply() {
    raf = 0;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${baseRotate}deg)`;
    el.style.setProperty("--sheen-x", `${50 + ry * 4}%`);
    el.style.setProperty("--sheen-o", "1");
  }

  function onMove(e) {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry = (px - 0.5) * 2 * max;
    rx = -(py - 0.5) * 2 * max;
    if (!raf) raf = requestAnimationFrame(apply);
  }

  function onLeave() {
    rx = 0;
    ry = 0;
    el.style.transition = "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg) rotate(${baseRotate}deg)`;
    el.style.setProperty("--sheen-o", "0");
    setTimeout(() => (el.style.transition = ""), 600);
  }

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
}

// ---------------------------------------------------------------------------
// Click spark. A small burst of ink flecks leaves the point of a press, like
// stamp ink spattering when the gate stamps a ticket. Ink colored, brief.
// ---------------------------------------------------------------------------

export function attachClickSpark(el, opts = {}) {
  if (!el) return;
  const color = opts.color ?? "var(--stamp)";
  const count = opts.count ?? 10;

  el.addEventListener("pointerdown", (e) => {
    if (reduced.matches) return;
    const layer = document.createElement("div");
    layer.className = "spark-layer";
    layer.style.left = `${e.clientX}px`;
    layer.style.top = `${e.clientY}px`;
    document.body.appendChild(layer);

    const flecks = [];
    for (let i = 0; i < count; i++) {
      const fleck = document.createElement("span");
      fleck.className = "spark";
      fleck.style.background = color;
      layer.appendChild(fleck);
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = 14 + Math.random() * 20;
      flecks.push({ el: fleck, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist });
    }

    const start = performance.now();
    const dur = 450;
    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      for (const f of flecks) {
        f.el.style.transform = `translate(${f.dx * eased}px, ${f.dy * eased}px) scale(${1 - t})`;
        f.el.style.opacity = String(1 - t);
      }
      if (t < 1) requestAnimationFrame(frame);
      else layer.remove();
    }
    requestAnimationFrame(frame);
  });
}

// ---------------------------------------------------------------------------
// Cursor light. A faint warm reading light follows the pointer across a
// surface. Paper catching the light, not a neon spotlight. Very low opacity.
// ---------------------------------------------------------------------------

export function setupCursorLight(el) {
  if (!el || reduced.matches) return;
  let raf = 0;
  let x = 50;
  let y = 30;
  function apply() {
    raf = 0;
    el.style.setProperty("--lx", `${x}%`);
    el.style.setProperty("--ly", `${y}%`);
  }
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    x = ((e.clientX - r.left) / r.width) * 100;
    y = ((e.clientY - r.top) / r.height) * 100;
    if (!raf) raf = requestAnimationFrame(apply);
    el.classList.add("lit");
  });
  el.addEventListener("pointerleave", () => el.classList.remove("lit"));
}
