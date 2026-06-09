// Tollgate ledger. Polls the API, reveals new tickets with a stamp press, and
// keeps the reconciliation totals live. Plain modules, no framework.

const els = {
  tickets: document.getElementById("tickets"),
  empty: document.getElementById("empty"),
  skeleton: document.getElementById("skeleton"),
  error: document.getElementById("error"),
  status: document.getElementById("status"),
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

function render(data) {
  explorer = data.explorer || explorer;
  const recon = data.reconciliation;
  els.totalReceived.textContent = recon.totalReceivedFormatted ?? "0.00";
  els.paidCount.textContent = String(recon.paidCount ?? 0);
  els.voidCount.textContent = String(recon.voidedCount ?? 0);

  els.skeleton.hidden = true;
  els.error.hidden = true;

  const receipts = data.receipts ?? [];
  if (receipts.length === 0) {
    els.empty.hidden = false;
    els.status.textContent = "Watching the gate.";
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

  els.status.textContent = `${recon.paidCount} cleared, ${recon.voidedCount} voided. Live.`;
  firstLoad = false;
}

async function tick() {
  try {
    const res = await fetch("./api/ledger");
    if (!res.ok) throw new Error(`ledger responded ${res.status}`);
    render(await res.json());
  } catch (err) {
    els.skeleton.hidden = true;
    els.error.hidden = false;
    els.error.textContent = "Could not read the ledger: " + (err?.message ?? err);
    els.status.textContent = "Disconnected. Retrying.";
  }
}

els.seed?.addEventListener("click", async () => {
  els.seed.disabled = true;
  try {
    await fetch("./api/demo/seed", { method: "POST" });
    await tick();
  } finally {
    setTimeout(() => (els.seed.disabled = false), 1500);
  }
});

tick();
setInterval(tick, 1500);
