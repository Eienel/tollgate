import { useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { Decrypt, Magnetic, Tilt, CountUp, Reveal, SPRING } from "./bits.jsx";

const SITE = "https://tollgate-pharos.vercel.app";
const REPO = "https://github.com/Eienel/tollgate";

const GAPS = [
  ["01", "No hosted facilitator", "Pharos runs no verify-and-settle service; the public facilitator is Base only. Tollgate bundles one for Atlantic and Pacific with retry, idempotent settle, and a health probe."],
  ["02", "Idempotency, on you", "The docs demand a payment is never billed or granted twice, with no turnkey answer. Tollgate makes it first class: a persistent dedupe keyed by tx hash that survives restart."],
  ["03", "Sessions, on you", "After payment you should not re-verify on chain every request. Tollgate mints a signed, short-lived session token bound to the receipt."],
  ["04", "Network confusion", "Two testnets, an internal-looking RPC, a test USDC flagged unofficial. Tollgate defines the chain once, pins verified endpoints, and probes the token before trusting it."],
];

const TOOLS = [
  ["protect_endpoint", "seller", "Build the x402 middleware config to gate a route by price."],
  ["verify_payment", "seller", "Idempotently verify a payment and decide the grant. Never twice."],
  ["issue_access_token", "seller", "Mint a short-lived session token after a verified payment."],
  ["verify_access_token", "seller", "Check a presented token: signature, expiry, claims. No chain calls."],
  ["list_receipts", "seller", "List receipts plus an earnings reconciliation summary."],
  ["pay_for_resource", "buyer", "Pay a 402-gated endpoint per call within spend caps."],
];

const CHIPS = [
  ["Chain", "eip155:688689 / 1672"],
  ["Settle", "idempotent"],
  ["Receipts", "HMAC-signed"],
  ["Token", "USDC, 6dp"],
  ["Facilitator", "bundled"],
  ["Sessions", "JWT, 900s"],
  ["Rails", "spend caps"],
  ["Claim", "signature-bound"],
];

function GateMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V8l8-4 8 4v12" />
      <path d="M4 12h16" />
      <path d="M9 20v-5h6v5" />
    </svg>
  );
}

function HeroTicket() {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 600], [0, -60]);
  return (
    <div className="ticket-stage">
      <motion.div
        className="big-ticket"
        style={{ y }}
        initial={{ opacity: 0, y: 30, rotateX: 12 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ ...SPRING, delay: 0.15 }}
      >
        <span className="bt-perf l" />
        <span className="bt-perf r" />
        <div className="bt-top">
          <span className="bt-label">Toll ticket</span>
          <span className="bt-no">No. 000482</span>
        </div>
        <div className="bt-route">GET /report</div>
        <div className="bt-meta">eip155:688689 &middot; payer 0x7c41&hellip;9e2d</div>
        <div className="bt-amount">
          <span className="v">0.10</span>
          <span className="u">USDC</span>
        </div>
        <div className="barcode" />
        <motion.span
          className="stamp paid"
          initial={{ scale: 2.6, opacity: 0, rotate: 4 }}
          animate={{ scale: 1, opacity: 1, rotate: -12 }}
          transition={{ type: "spring", stiffness: 220, damping: 12, delay: 0.7 }}
        >
          Paid
        </motion.span>
      </motion.div>
    </div>
  );
}

function Hero() {
  const lines = ["Pay at", "the gate."];
  return (
    <section className="hero">
      <div className="wrap">
        <motion.span className="eyebrow" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="dot" /> x402 merchant layer for Pharos
        </motion.span>
        <div className="hero-grid">
          <div>
            <h1 className="display">
              {lines.map((ln, i) => (
                <span className="line" key={i}>
                  <motion.span
                    style={{ display: "inline-block" }}
                    initial={{ y: "110%" }}
                    animate={{ y: 0 }}
                    transition={{ ...SPRING, delay: 0.1 + i * 0.08 }}
                  >
                    {ln}
                  </motion.span>
                </span>
              ))}
              <span className="line">
                <motion.em
                  style={{ display: "inline-block" }}
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{ ...SPRING, delay: 0.28 }}
                >
                  Stamped once.
                </motion.em>
              </span>
            </h1>
            <motion.p className="hero-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }}>
              A TypeScript MCP server that turns any AI agent into a reliable paid merchant
              on Pharos using x402. A payment can never grant access or be billed twice, and
              that guarantee survives a restart.
            </motion.p>
            <motion.div className="hero-actions" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
              <Magnetic strength={0.5}>
                <a className="btn btn-primary" href="#start">Use it in one line</a>
              </Magnetic>
              <Magnetic strength={0.4}>
                <a className="btn btn-ghost" href={REPO} target="_blank" rel="noreferrer">Read the source</a>
              </Magnetic>
            </motion.div>
            <div className="hero-facts">
              <Reveal className="fact" delay={0.7}>
                <div className="n"><CountUp to={7} /></div>
                <div className="l">MCP tools</div>
              </Reveal>
              <Reveal className="fact" delay={0.78}>
                <div className="n"><CountUp to={2} /></div>
                <div className="l">Pharos networks</div>
              </Reveal>
              <Reveal className="fact" delay={0.86}>
                <div className="n"><CountUp to={0} /></div>
                <div className="l">Double bills, ever</div>
              </Reveal>
            </div>
          </div>
          <HeroTicket />
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const row = [...CHIPS, ...CHIPS];
  return (
    <div className="marquee" aria-hidden="true">
      <motion.div
        className="marquee-track"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ repeat: Infinity, ease: "linear", duration: 30 }}
      >
        {row.map(([k, v], i) => (
          <span className="chip" key={i}>
            <span>{k}</span>
            <b>{v}</b>
            <span className="sep">/</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function Gaps() {
  return (
    <section className="pad" id="why">
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Why it exists</div>
            <h2 className="head">Four gaps Pharos documents but does not solve.</h2>
          </div>
          <p>The official x402 example gets you a demo. Tollgate closes the rest, and the gaps are in their own docs.</p>
        </div>
        <div className="cards">
          {GAPS.map(([idx, title, body], i) => (
            <Reveal key={idx} delay={i * 0.06}>
              <Tilt className="card" max={7}>
                <span className="watermark">{idx}</span>
                <span className="idx">{idx}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Step0() {
  return (
    <section className="pad" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Step 0</div>
            <h2 className="head">We probed the token before trusting it.</h2>
          </div>
          <p>The Atlantic test USDC has no EIP-3009, so the gasless exact scheme cannot settle against it. The payment path is honest about that.</p>
        </div>
        <Reveal>
          <div className="code">
            <div><span className="m"># probe the test USDC for EIP-3009</span></div>
            <div>token&nbsp;&nbsp;<Decrypt text="0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8" charset="hex" /> <span className="m">USD Coin, 6dp</span></div>
            <div>proxy&nbsp;&nbsp;<span className="g">none</span> <span className="m">not an EIP-1967 proxy</span></div>
            <div>DOMAIN_SEPARATOR()&nbsp;&nbsp;reverts</div>
            <div>transferWithAuthorization&nbsp;&nbsp;absent</div>
            <div>permit&nbsp;&nbsp;absent</div>
            <div className="g">verdict: plain ERC-20, settle by confirmed transfer, idempotently</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Demo() {
  const [rows, setRows] = useState([]);
  const [stamp, setStamp] = useState(null); // 'paid' | 'void' | null
  const [paid, setPaid] = useState(0);
  const [voided, setVoided] = useState(0);
  const [tx, setTx] = useState(null);

  function rand() {
    return "0x" + Array.from({ length: 8 }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");
  }

  function pay() {
    const h = rand();
    setTx(h);
    setStamp("paid");
    setPaid((p) => p + 1);
    setRows((r) => [{ id: Date.now(), tx: h, status: "PAID" }, ...r].slice(0, 5));
  }

  function replay() {
    if (!tx) return;
    setStamp("void");
    setVoided((v) => v + 1);
    setRows((r) => [{ id: Date.now(), tx, status: "VOID" }, ...r].slice(0, 5));
  }

  return (
    <section className="pad" id="demo" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="demo">
          <div className="section-head">
            <div>
              <div className="kicker" style={{ color: "#6fd39f" }}>The signature element</div>
              <h2 className="head">Stamp it once. Replay it, and watch it void.</h2>
            </div>
            <p className="muted">This is idempotency made physical. The same tx hash can clear once. A replay is blocked and stamped void, pointing at the original.</p>
          </div>

          <div className="demo-stage">
            <div className="demo-ticket">
              <div className="r">GET /report</div>
              <div style={{ color: "#6b6760", fontSize: 12, marginTop: 6 }}>
                {tx ? `tx ${tx}` : "no payment yet"}
              </div>
              <div style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: 38, marginTop: 14 }}>0.10 <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "#6b6760" }}>USDC</span></div>
              <AnimatePresence>
                {stamp && (
                  <motion.span
                    key={stamp + rows.length}
                    className={`stamp ${stamp}`}
                    style={{ top: 20, right: 22, fontSize: 22 }}
                    initial={{ scale: 2.4, opacity: 0, rotate: 3 }}
                    animate={{ scale: 1, opacity: 1, rotate: stamp === "paid" ? -11 : -8 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 240, damping: 11 }}
                  >
                    {stamp === "paid" ? "Paid" : "Void"}
                  </motion.span>
                )}
              </AnimatePresence>

              <div className="demo-actions">
                <Magnetic strength={0.35}>
                  <button className="btn btn-dark" onClick={pay}>Process payment</button>
                </Magnetic>
                <Magnetic strength={0.3}>
                  <button className="btn btn-outline" onClick={replay} disabled={!tx} style={{ opacity: tx ? 1 : 0.5 }}>
                    Replay same tx
                  </button>
                </Magnetic>
              </div>
            </div>

            <div>
              <div className="demo-ledger">
                <AnimatePresence initial={false}>
                  {rows.length === 0 && (
                    <motion.div className="demo-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: "#7a766b" }}>
                      <span>ledger empty</span><span>--</span>
                    </motion.div>
                  )}
                  {rows.map((r) => (
                    <motion.div
                      className="demo-row"
                      key={r.id}
                      layout
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={SPRING}
                    >
                      <span>{r.tx}</span>
                      <span className={`s ${r.status.toLowerCase()}`}>{r.status}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="counter-row">
                <div className="counter">
                  <div className="v">{paid}</div>
                  <div className="l">cleared</div>
                </div>
                <div className="counter">
                  <div className="v">{voided}</div>
                  <div className="l">voided</div>
                </div>
                <div className="counter">
                  <div className="v">{(paid * 0.1).toFixed(2)}</div>
                  <div className="l">USDC billed</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Tools() {
  return (
    <section className="pad" id="tools" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">The surface</div>
            <h2 className="head">Seven tools. Two sides. One skill.</h2>
          </div>
          <p>Mount it over stdio or HTTP. Any agent can sell, and any agent can pay.</p>
        </div>
        <div className="tools">
          {TOOLS.map(([name, side, body], i) => (
            <Reveal key={name} delay={(i % 3) * 0.06}>
              <div className="tool">
                <div>
                  <span className="name">{name}</span>
                  <span className="side">{side}</span>
                </div>
                <p>{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Start() {
  return (
    <section className="pad" id="start" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">Frictionless</div>
            <h2 className="head">One line. No clone, no build.</h2>
          </div>
          <p>Zero-config by default. A signing secret is generated and persisted on first run. A key is only needed to pay or settle.</p>
        </div>
        <Reveal>
          <div className="code">
            <div><span className="m">// any MCP client config</span></div>
            <div>{"{"}</div>
            <div>&nbsp;&nbsp;"mcpServers": {"{"}</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;"tollgate": {"{"}</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"command": <span className="g">"npx"</span>,</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"args": [<span className="g">"-y"</span>, <span className="g">"x402-merchant"</span>],</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"env": {"{"} "TOLLGATE_NETWORK": <span className="g">"atlantic"</span> {"}"}</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;{"}"}</div>
            <div>&nbsp;&nbsp;{"}"}</div>
            <div>{"}"}</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div>
          <h3>Pay at the gate.</h3>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>Tollgate, an x402 merchant layer for Pharos.</p>
        </div>
        <div className="links">
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={SITE} target="_blank" rel="noreferrer">Live ledger</a>
          <a href="#start">Install</a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <span className="brand"><GateMark /> Tollgate</span>
          <div className="nav-links">
            <a href="#why">Why</a>
            <a href="#demo">Demo</a>
            <a href="#tools">Tools</a>
            <a href="#start">Install</a>
          </div>
          <a className="nav-cta" href={SITE} target="_blank" rel="noreferrer">Live ledger</a>
        </div>
      </nav>
      <Hero />
      <Marquee />
      <Gaps />
      <Step0 />
      <Demo />
      <Tools />
      <Start />
      <Footer />
    </>
  );
}
