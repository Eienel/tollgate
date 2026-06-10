// Tollgate ledger. Polls the API, reveals new tickets with a stamp press, and
// keeps the reconciliation totals live. Plain modules, no framework.
//
// Two modes. Live: a Tollgate dashboard server is present and /api/ledger reads
// the real receipts log. Static: no backend (for example the hosted demo), so
// Run demo stamps tickets client-side with the same shapes the skill produces.

const els = {
  tickets: document.getElementById("tickets"),
  empty: document.getElementById("empty"),
  skeleton: document.getElementById("skeleton"),
  error: document.getElementById("error"),
  status: document.getElementById("status"),
  modeNote: document.getElementById("mode-note"),
  totalReceived: document.getElementById("total-received"),
  totalUnit: document.getElementById("total-unit"),
  paidCount: document.getElementById("paid-count"),
  voidCount: document.getElementById("void-count"),
  seed: document.getElementById("seed"),
};

// Track which receipt ids we have already drawn, so only new ones animate.
const seen = new Set();
let explorer = "https://atlantic.pharosscan.xyz";
let firstLoad = true;
let staticMode = false;
let pollTimer = null;

// Client-side ledger for static mode.
const localReceipts = [];

function shorten(s, head = 6, tail = 4) {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtUsdc(atomic, decimals) {
  const n = Number(atomic) / 10 ** decimals;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function ticketRow(r, animate) {
  const li = document.createElement("li");
  li.className = "ticket" + (animate ? " enter" : "");
  li.dataset.id = r.id;

  const main = document.createElement("div");
  main.className = "ticket-main";

  const resource = document.createElement("div");
  resource.className = "ticket-resource";
  resource.textContent = r.resource;

  const meta = document.createElement("div");
  meta.className = "ticket-meta";
  const idSpan = document.createElement("span");
  idSpan.className = "ticket-id";
  idSpan.textContent = r.id.replace("rcpt_", "no. ");
  const payerSpan = document.createElement("span");
  payerSpan.textContent = "from " + shorten(r.payer);
  const timeSpan = document.createElement("span");
  timeSpan.textContent = fmtTime(r.createdAt);
  meta.append(idSpan, payerSpan, timeSpan);
  if (r.status === "VOID" && r.duplicateOf) {
    const dup = document.createElement("span");
    dup.textContent = "duplicate of " + r.duplicateOf.replace("rcpt_", "no. ");
    meta.append(dup);
  }
  main.append(resource, meta);

  const side = document.createElement("div");
  side.className = "ticket-side";

  const stamp = document.createElement("span");
  stamp.className = "stamp " + (r.status === "PAID" ? "paid" : "void");
  stamp.textContent = r.status;
  stamp.setAttribute("aria-label", r.status === "PAID" ? "Paid and cleared" : "Voided duplicate");

  const amount = document.createElement("div");
  amount.className = "amount";
  amount.textContent = fmtUsdc(r.amount, r.decimals) + " USDC";

  const link = document.createElement("a");
  link.className = "tx-link";
  link.href = `${explorer}/tx/${r.txHash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = shorten(r.txHash, 8, 6);

  side.append(stamp, amount, link);
  li.append(main, side);
  return li;
}

function reconcileLocal(receipts) {
  const paid = receipts.filter((r) => r.status === "PAID");
  const voided = receipts.filter((r) => r.status === "VOID");
  const decimals = paid[0]?.decimals ?? 6;
  let total = 0;
  for (const r of paid) total += Number(r.amount);
  return {
    totalReceivedFormatted: fmtUsdc(total, decimals),
    paidCount: paid.length,
    voidedCount: voided.length,
  };
}

// Count a figure up to its new value, then give it a small bump. Feedback for
// money arriving. Falls back to a plain swap under reduced motion.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setFigure(el, next, format) {
  const target = Number(next);
  const prev = Number((el.dataset.value ?? el.textContent).replace(/,/g, "")) || 0;
  el.dataset.value = String(target);
  if (reducedMotion.matches || !Number.isFinite(target) || target === prev) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now();
  const dur = 600;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(prev + (target - prev) * eased);
    if (t < 1) requestAnimationFrame(frame);
    else {
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }
  }
  requestAnimationFrame(frame);
}

const fmtMoney = (v) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCount = (v) => String(Math.round(v));

function render(data) {
  explorer = data.explorer || explorer;
  const recon = data.reconciliation;
  setFigure(els.totalReceived, Number(String(recon.totalReceivedFormatted ?? "0").replace(/,/g, "")), fmtMoney);
  setFigure(els.paidCount, recon.paidCount ?? 0, fmtCount);
  setFigure(els.voidCount, recon.voidedCount ?? 0, fmtCount);

  els.skeleton.hidden = true;
  els.error.hidden = true;

  const receipts = data.receipts ?? [];
  if (receipts.length === 0 && seen.size === 0) {
    els.empty.hidden = false;
    els.status.textContent = staticMode ? "Static demo. The gate is sleeping." : "Watching the gate.";
    firstLoad = false;
    return;
  }
  els.empty.hidden = true;

  // Receipts arrive newest first. Prepend new ones with a staggered stamp press.
  const fresh = receipts.filter((r) => !seen.has(r.id));
  // Draw oldest-of-the-new first so the newest ends up on top.
  fresh.reverse().forEach((r, i) => {
    const animate = !firstLoad;
    const row = ticketRow(r, animate);
    if (animate) row.style.animationDelay = `${i * 70}ms`;
    els.tickets.prepend(row);
    seen.add(r.id);
  });

  els.status.textContent = staticMode
    ? `${recon.paidCount} cleared, ${recon.voidedCount} voided. Static demo.`
    : `${recon.paidCount} cleared, ${recon.voidedCount} voided. Live.`;
  firstLoad = false;
}

async function tick() {
  try {
    const res = await fetch("./api/ledger");
    if (!res.ok) throw new Error(`ledger responded ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("no ledger API behind this page");
    render(await res.json());
  } catch {
    enterStaticMode();
  }
}

// ---------------------------------------------------------------------------
// Static mode: the hosted page has no gate attached, so the demo runs in the
// browser with the exact receipt shapes the skill writes.
// ---------------------------------------------------------------------------

function enterStaticMode() {
  if (!staticMode) {
    staticMode = true;
    if (pollTimer) clearInterval(pollTimer);
    els.modeNote.textContent =
      "This hosted page has no live gate attached. Run demo replays a real flow client-side. Run npm run dashboard locally for the live ledger.";
  }
  els.skeleton.hidden = true;
  els.error.hidden = true;
  renderLocal();
}

function renderLocal() {
  render({
    receipts: [...localReceipts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    reconciliation: reconcileLocal(localReceipts),
    explorer,
  });
}

function randomHex(n) {
  let s = "0x";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function makeLocalReceipt(base, status, duplicateOf) {
  return {
    id: "rcpt_" + crypto.randomUUID(),
    status,
    duplicateOf,
    createdAt: new Date().toISOString(),
    ...base,
  };
}

function runLocalDemo() {
  const prices = ["100000", "250000", "50000"];
  const base = {
    txHash: randomHex(64),
    payer: randomHex(40),
    amount: prices[Math.floor(Math.random() * prices.length)],
    decimals: 6,
    resource: "GET /report",
  };
  const paid = makeLocalReceipt(base, "PAID");
  localReceipts.push(paid);
  renderLocal();
  // The replay arrives a beat later and is blocked. Same tx hash, VOID stamp.
  setTimeout(() => {
    localReceipts.push(makeLocalReceipt(base, "VOID", paid.id));
    renderLocal();
  }, 1400);
}

els.seed?.addEventListener("click", async () => {
  els.seed.disabled = true;
  try {
    if (staticMode) {
      runLocalDemo();
    } else {
      await fetch("./api/demo/seed", { method: "POST" });
      await tick();
    }
  } finally {
    setTimeout(() => (els.seed.disabled = false), 1800);
  }
});

tick().then(() => {
  if (!staticMode) pollTimer = setInterval(tick, 1500);
});

// ---------------------------------------------------------------------------
// Life. Scroll reveals sequence the documentation; the demo button leans
// toward the hand. Reveals use IntersectionObserver, never a scroll listener.
// The magnetic effect drives transform only, outside any layout work, and
// both collapse under reduced motion.
// ---------------------------------------------------------------------------

function setupReveals() {
  const sections = document.querySelectorAll(".doc");
  if (!("IntersectionObserver" in window) || reducedMotion.matches) return;

  for (const section of sections) {
    section.classList.add("reveal");
    // Stagger the grouped children inside a section: gap cards and steps.
    const children = section.querySelectorAll(".gap, .steps li");
    children.forEach((child, i) => {
      child.classList.add("reveal");
      child.style.setProperty("--index", String(i + 1));
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in-view");
        for (const child of entry.target.querySelectorAll(".reveal")) {
          child.classList.add("in-view");
        }
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -60px 0px", threshold: 0.1 },
  );
  for (const section of sections) io.observe(section);
}

function setupMagnetic(button) {
  if (!button || reducedMotion.matches) return;
  const RADIUS = 80;
  const PULL = 0.22;
  let raf = 0;
  let tx = 0;
  let ty = 0;
  let pressed = false;

  function apply() {
    raf = 0;
    const press = pressed ? " scale(0.96)" : "";
    button.style.transform = tx || ty || pressed ? `translate(${tx}px, ${ty}px)${press}` : "";
  }

  function onMove(e) {
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < RADIUS) {
      tx = dx * PULL;
      ty = dy * PULL;
    } else {
      tx = 0;
      ty = 0;
    }
    if (!raf) raf = requestAnimationFrame(apply);
  }

  function onLeave() {
    tx = 0;
    ty = 0;
    if (!raf) raf = requestAnimationFrame(apply);
  }

  // Listen on the ledger column only, not the whole window.
  const zone = button.closest(".rolls") ?? button.parentElement;
  zone.addEventListener("pointermove", onMove);
  zone.addEventListener("pointerleave", onLeave);
  button.addEventListener("pointerdown", () => {
    pressed = true;
    if (!raf) raf = requestAnimationFrame(apply);
  });
  for (const ev of ["pointerup", "pointercancel"]) {
    window.addEventListener(ev, () => {
      if (!pressed) return;
      pressed = false;
      if (!raf) raf = requestAnimationFrame(apply);
    });
  }
}

setupReveals();
setupMagnetic(els.seed);
