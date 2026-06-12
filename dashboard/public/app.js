// Tollgate ledger. A read-only, on-chain page: it verifies a settlement tx and
// counts payments to a merchant, both straight from the Pharos Atlantic RPC in
// the browser. No backend, no wallet. Plain modules, no framework.

import { decryptOnLoad, setupTilt, setupCursorLight } from "./effects.js";
import { initTracker } from "./tracker.js";

const ATLANTIC_RPC = "https://atlantic.dplabs-internal.com";
const PHAROSSCAN = "https://atlantic.pharosscan.xyz";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function shorten(s, head = 6, tail = 4) {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

async function rpc(method, params) {
  const res = await fetch(ATLANTIC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

// Decode an ABI-encoded dynamic string returned by a view call. Falls back to
// the empty string for non-standard tokens (for example bytes32 symbols).
function decodeAbiString(hex) {
  try {
    const h = hex.slice(2);
    const len = parseInt(h.slice(64, 128), 16) * 2;
    const bytes = h.slice(128, 128 + len);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
      out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
    }
    return out;
  } catch {
    return "";
  }
}

async function tokenMeta(token) {
  let decimals = 18;
  let symbol = "token";
  try {
    const d = await ethCall(token, "0x313ce567"); // decimals()
    if (d && d !== "0x") decimals = parseInt(d, 16);
  } catch {}
  try {
    const s = await ethCall(token, "0x95d89b41"); // symbol()
    const decoded = decodeAbiString(s).replace(/[^\x20-\x7e]/g, "").trim();
    if (decoded) symbol = decoded;
  } catch {}
  return { decimals, symbol };
}

function formatAmount(raw, decimals) {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return (neg ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}

// ---------------------------------------------------------------------------
// Verify a settlement: read the receipt, decode the ERC-20 Transfer that paid
// the gate, and show it. Read-only confirmation that the payment is real.
// ---------------------------------------------------------------------------

const v = {
  hash: document.getElementById("vrf-hash"),
  btn: document.getElementById("vrf-btn"),
  status: document.getElementById("vrf-status"),
  result: document.getElementById("vrf-result"),
  stamp: document.getElementById("vrf-stamp"),
  explorer: document.getElementById("vrf-explorer"),
  confirmed: document.getElementById("vrf-confirmed"),
  block: document.getElementById("vrf-block"),
  from: document.getElementById("vrf-from"),
  to: document.getElementById("vrf-to"),
  amount: document.getElementById("vrf-amount"),
  token: document.getElementById("vrf-token"),
};

function setStamp(el, kind, text) {
  el.className = "stamp " + kind;
  el.textContent = text;
}

async function verify() {
  const hash = (v.hash.value || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    v.status.textContent = "Enter a 32-byte transaction hash (0x and 64 hex characters).";
    v.result.hidden = true;
    return;
  }
  v.btn.disabled = true;
  v.status.textContent = "Reading the receipt from Atlantic…";
  try {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (!r) {
      v.status.textContent = "No receipt found for that hash on Atlantic yet.";
      v.result.hidden = true;
      return;
    }
    const ok = r.status === "0x1";
    const log = (r.logs || []).find(
      (l) => l.topics && l.topics.length === 3 && l.topics[0] === TRANSFER_TOPIC,
    );

    v.explorer.href = `${PHAROSSCAN}/tx/${hash}`;
    v.block.textContent = parseInt(r.blockNumber, 16).toLocaleString();
    v.confirmed.textContent = ok ? "success" : "reverted";

    if (log) {
      const from = "0x" + log.topics[1].slice(26);
      const to = "0x" + log.topics[2].slice(26);
      const value = BigInt(log.data);
      const meta = await tokenMeta(log.address);
      v.from.textContent = shorten(from, 10, 8);
      v.from.title = from;
      v.to.textContent = shorten(to, 10, 8);
      v.to.title = to;
      v.amount.textContent = `${formatAmount(value, meta.decimals)} ${meta.symbol}`;
      v.token.textContent = shorten(log.address, 10, 8);
      v.token.title = log.address;
    } else {
      v.from.textContent = v.to.textContent = v.amount.textContent = v.token.textContent = "no ERC-20 transfer in this tx";
    }

    setStamp(v.stamp, ok ? "paid" : "void", ok ? "PAID" : "VOID");
    if (!reducedMotion.matches && ok) {
      v.stamp.classList.remove("press");
      void v.stamp.offsetWidth;
      v.stamp.classList.add("press");
    }
    v.result.hidden = false;
    v.status.textContent = ok
      ? "Confirmed on-chain, read live from the Atlantic RPC."
      : "This transaction reverted on-chain.";
  } catch (err) {
    v.status.textContent = "RPC unreachable. Open the transaction on PharosScan instead.";
    v.explorer.href = `${PHAROSSCAN}/tx/${hash}`;
  } finally {
    v.btn.disabled = false;
  }
}

v.btn?.addEventListener("click", verify);
v.hash?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verify();
});

// ---------------------------------------------------------------------------
// Life. Scroll reveals sequence the two ledger sections; the specimen prints
// its figures and leans toward the cursor; the masthead catches the light.
// All collapse under reduced motion.
// ---------------------------------------------------------------------------

function setupReveals() {
  const sections = document.querySelectorAll(".doc");
  if (!("IntersectionObserver" in window) || reducedMotion.matches) return;
  for (const section of sections) section.classList.add("reveal");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -60px 0px", threshold: 0.1 },
  );
  for (const section of sections) io.observe(section);
}

setupReveals();
decryptOnLoad();
setupTilt(document.getElementById("specimen"), { baseRotate: -1, max: 6 });
setupCursorLight(document.querySelector(".masthead"));

// The live on-chain payment tracker (the counting half of the ledger).
initTracker();
