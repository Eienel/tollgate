// tracker.js
// A real on-chain payment tracker that runs entirely in the browser. Given a
// merchant address and a token, it reads ERC-20 Transfer events straight from a
// Pharos RPC (CORS is open on both Atlantic testnet and Pacific mainnet) and
// counts the payments that landed. Progress is remembered in localStorage, so
// the count is cumulative across visits and grows as new blocks arrive, without
// any backend. Each scan only reads new blocks; "scan deeper" extends the
// window backward.

const NETWORKS = {
  atlantic: {
    label: "Atlantic testnet",
    chainId: 688689,
    rpc: "https://atlantic.dplabs-internal.com",
    explorer: "https://atlantic.pharosscan.xyz",
    defaultToken: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
    testnet: true,
  },
  mainnet: {
    label: "Pacific mainnet",
    chainId: 1672,
    rpc: "https://rpc.pharos.xyz",
    explorer: "https://pharosscan.xyz",
    defaultToken: "",
    testnet: false,
  },
};

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WINDOW = 1000; // RPC caps eth_getLogs at 1000 blocks per call.
const CONCURRENCY = 6;
const DEFAULT_DEPTH = 40; // windows scanned on first run (40k blocks).
const DEEPER_DEPTH = 60; // windows added per "scan deeper".

const els = {};
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

let scanning = false;

function $(id) {
  return document.getElementById(id);
}

function isAddress(a) {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

function pad32(addr) {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function shorten(s, head = 6, tail = 4) {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function fmtUnits(value, decimals) {
  const neg = value < 0n;
  let v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const n = `${whole}${frac ? "." + frac : ""}`;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

async function rpc(net, method, params) {
  const res = await fetch(net.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}

async function getDecimals(net, token) {
  try {
    // decimals() selector 0x313ce567
    const out = await rpc(net, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"]);
    const d = parseInt(out, 16);
    return Number.isFinite(d) && d >= 0 && d <= 36 ? d : 6;
  } catch {
    return 6;
  }
}

// Storage. Keyed by network, token, and merchant so distinct gates do not mix.
function storeKey(netName, token, merchant) {
  return `tollgate:tracker:${netName}:${token.toLowerCase()}:${merchant.toLowerCase()}`;
}

function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    s.payments = s.payments || {};
    return s;
  } catch {
    return null;
  }
}

function saveState(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // storage full or blocked; the scan still works for this session.
  }
}

// Scan a block range in 1000-block windows, with a little concurrency. Calls
// onLogs with each batch of decoded Transfer logs to the merchant.
async function scanRange(net, token, merchant, fromBlock, toBlock, onProgress) {
  const recipient = pad32(merchant);
  const windows = [];
  for (let start = fromBlock; start <= toBlock; start += WINDOW) {
    const end = Math.min(start + WINDOW - 1, toBlock);
    windows.push([start, end]);
  }
  const found = [];
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = windows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([from, to]) =>
        rpc(net, "eth_getLogs", [
          {
            fromBlock: "0x" + from.toString(16),
            toBlock: "0x" + to.toString(16),
            address: token,
            topics: [TRANSFER_TOPIC, null, recipient],
          },
        ]).catch(() => []),
      ),
    );
    for (const logs of results) {
      for (const log of logs) {
        found.push({
          txHash: log.transactionHash,
          from: "0x" + log.topics[1].slice(26),
          value: BigInt(log.data),
          block: parseInt(log.blockNumber, 16),
        });
      }
    }
    onProgress(Math.min(1, (i + CONCURRENCY) / windows.length));
  }
  return found;
}

function setStatus(text) {
  els.status.textContent = text;
}

function paymentRow(p, decimals, explorer, animate) {
  const li = document.createElement("li");
  li.className = "ticket" + (animate && !reduced.matches ? " enter" : "");

  const main = document.createElement("div");
  main.className = "ticket-main";
  const resource = document.createElement("div");
  resource.className = "ticket-resource";
  resource.textContent = "Payment received";
  const meta = document.createElement("div");
  meta.className = "ticket-meta";
  const from = document.createElement("span");
  from.textContent = "from " + shorten(p.from);
  const blk = document.createElement("span");
  blk.className = "ticket-id";
  blk.textContent = "block " + p.block.toLocaleString();
  meta.append(from, blk);
  main.append(resource, meta);

  const side = document.createElement("div");
  side.className = "ticket-side";
  const stamp = document.createElement("span");
  stamp.className = "stamp paid";
  stamp.textContent = "PAID";
  const amount = document.createElement("div");
  amount.className = "amount";
  amount.textContent = fmtUnits(p.value, decimals) + " USDC";
  const link = document.createElement("a");
  link.className = "tx-link";
  link.href = `${explorer}/tx/${p.txHash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = shorten(p.txHash, 8, 6);
  side.append(stamp, amount, link);

  li.append(main, side);
  return li;
}

function renderPayments(state, decimals, net) {
  const payments = Object.values(state.payments).sort((a, b) => b.block - a.block);
  els.count.textContent = String(payments.length);
  let total = 0n;
  for (const p of payments) total += BigInt(p.value);
  els.total.textContent = fmtUnits(total, decimals);

  els.list.innerHTML = "";
  if (payments.length === 0) {
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  for (const p of payments.slice(0, 50)) {
    els.list.append(
      paymentRow({ ...p, value: BigInt(p.value) }, decimals, net.explorer, false),
    );
  }
}

async function runScan({ deeper } = {}) {
  if (scanning) return;
  const netName = els.network.value;
  const net = NETWORKS[netName];
  const merchant = els.address.value.trim();
  const token = (els.token.value.trim() || net.defaultToken).trim();

  if (!isAddress(merchant)) {
    setStatus("Enter a valid merchant address (0x and 40 hex characters).");
    return;
  }
  if (!isAddress(token)) {
    setStatus("Enter a valid token address. Pacific mainnet has no default token.");
    return;
  }

  scanning = true;
  els.scan.disabled = true;
  els.deeper.disabled = true;
  els.results.hidden = false;
  setStatus("Reading the chain...");

  try {
    const key = storeKey(netName, token, merchant);
    const state = loadState(key) || { high: 0, low: 0, payments: {} };
    const decimals = await getDecimals(net, token);
    const latest = parseInt(await rpc(net, "eth_blockNumber", []), 16);

    let from;
    let to;
    if (!state.high) {
      // First run: scan a recent window.
      to = latest;
      from = Math.max(0, latest - DEFAULT_DEPTH * WINDOW);
    } else if (deeper) {
      // Extend backward from the oldest block already covered.
      to = state.low - 1;
      from = Math.max(0, state.low - DEEPER_DEPTH * WINDOW);
      if (to < from) {
        setStatus("Reached the start of the scanned range.");
        scanning = false;
        els.scan.disabled = false;
        els.deeper.disabled = false;
        return;
      }
    } else {
      // Follow-up: pick up only the new blocks since last time.
      from = state.high + 1;
      to = latest;
      if (from > to) {
        renderPayments(state, decimals, net);
        setStatus(`Up to date at block ${latest.toLocaleString()}. ${Object.keys(state.payments).length} payments tracked.`);
        scanning = false;
        els.scan.disabled = false;
        els.deeper.disabled = false;
        return;
      }
    }

    const found = await scanRange(net, token, merchant, from, to, (pct) => {
      setStatus(`Scanning blocks ${from.toLocaleString()} to ${to.toLocaleString()} (${Math.round(pct * 100)}%)`);
    });

    for (const p of found) {
      state.payments[p.txHash.toLowerCase()] = {
        txHash: p.txHash,
        from: p.from,
        value: p.value.toString(),
        block: p.block,
      };
    }
    state.high = Math.max(state.high || 0, to);
    state.low = state.low ? Math.min(state.low, from) : from;
    saveState(key, state);

    renderPayments(state, decimals, net);
    els.deeper.hidden = false;
    const n = Object.keys(state.payments).length;
    setStatus(
      `${n} payment${n === 1 ? "" : "s"} tracked to ${shorten(merchant)} on ${net.label}. Scanned blocks ${state.low.toLocaleString()} to ${state.high.toLocaleString()}.`,
    );
  } catch (err) {
    setStatus("Could not read the chain: " + (err?.message ?? err));
  } finally {
    scanning = false;
    els.scan.disabled = false;
    els.deeper.disabled = false;
  }
}

function syncTokenPlaceholder() {
  const net = NETWORKS[els.network.value];
  els.token.placeholder = net.defaultToken
    ? `Default: ${net.defaultToken}`
    : "Token address (required on mainnet)";
}

export function initTracker() {
  els.network = $("trk-network");
  els.address = $("trk-address");
  els.token = $("trk-token");
  els.scan = $("trk-scan");
  els.deeper = $("trk-deeper");
  els.status = $("trk-status");
  els.results = $("trk-results");
  els.count = $("trk-count");
  els.total = $("trk-total");
  els.list = $("trk-list");
  els.empty = $("trk-empty");
  if (!els.network) return;

  // Remember the last address and network used.
  const lastAddr = localStorage.getItem("tollgate:tracker:lastAddress");
  const lastNet = localStorage.getItem("tollgate:tracker:lastNetwork");
  if (lastAddr) els.address.value = lastAddr;
  if (lastNet && NETWORKS[lastNet]) els.network.value = lastNet;
  syncTokenPlaceholder();

  els.network.addEventListener("change", syncTokenPlaceholder);
  els.scan.addEventListener("click", () => {
    localStorage.setItem("tollgate:tracker:lastAddress", els.address.value.trim());
    localStorage.setItem("tollgate:tracker:lastNetwork", els.network.value);
    runScan();
  });
  els.deeper.addEventListener("click", () => runScan({ deeper: true }));
  els.address.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.scan.click();
  });
}
