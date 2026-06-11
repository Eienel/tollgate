import { useRef, useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform, useSpring, useMotionValue } from "framer-motion";
import { Decrypt, Magnetic, Tilt, CountUp, Reveal, CustomCursor, useIsTouch, SPRING } from "./bits.jsx";

const SITE = "https://tollgate-pharos.vercel.app";
const REPO = "https://github.com/Eienel/tollgate";

// A real Tollgate payment settled on Pharos Atlantic, granted once and then
// blocked on replay by idempotency. The proof panel verifies it live against
// the public RPC.
const PROOF_TX = "0xebde6ded03335f182e45050916a1f1a2e2a8695be6d64fd42e812b0295cf8f4f";
const ATLANTIC_RPC = "https://atlantic.dplabs-internal.com";
const PHAROSSCAN = "https://atlantic.pharosscan.xyz";

// On-theme photos from Unsplash, treated as ink-and-paper duotone in CSS.
const IMG = {
  press: "https://images.unsplash.com/photo-1581508512961-0e3b9524db40?w=1600&q=70&auto=format&fit=crop",
  booth: "https://images.unsplash.com/photo-1611839267623-8a861c18d52c?w=900&q=65&auto=format&fit=crop",
  paper: "https://images.unsplash.com/photo-1601662528567-526cd06f6582?w=1200&q=60&auto=format&fit=crop",
};

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });
  return <motion.div className="progress" style={{ scaleX }} />;
}

const GAPS = [
  ["01", "No hosted facilitator", "Pharos runs no verify-and-settle service; the public facilitator is Base only. Tollgate bundles one for Atlantic with retry, idempotent settle, and a health probe."],
  ["02", "Idempotency, on you", "The docs demand a payment is never billed or granted twice, with no turnkey answer. Tollgate makes it first class: a persistent dedupe keyed by tx hash that survives restart."],
  ["03", "Sessions, on you", "After payment you should not re-verify on chain every request. Tollgate mints a signed, short-lived session token bound to the receipt."],
  ["04", "Network confusion", "Two testnets, an internal-looking RPC, a test USDC flagged unofficial. Tollgate defines the chain once, pins verified endpoints, and probes the token before trusting it."],
];

const TOOLS = [
  ["protect_endpoint", "seller", "Build the x402 middleware config to gate a route by price."],
  ["verify_payment", "seller", "Idempotently verify a payment and decide the grant. Never twice."],
  ["issue_access_token", "seller", "Mint a short-lived session token after a verified payment."],
  ["verify_access_token", "seller", "Check a presented token: signature, expiry, claims. No chain calls."],
  ["get_receipt", "seller", "Fetch one signed receipt and confirm its signature."],
  ["list_receipts", "seller", "List receipts plus an earnings reconciliation summary."],
  ["pay_for_resource", "buyer", "Pay a 402-gated endpoint per call within spend caps."],
  ["facilitator_status", "infra", "Health of the bundled facilitator: RPC, budget, account."],
];

const CHIPS = [
  ["Chain", "eip155:688689"],
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
  const yScroll = useTransform(scrollY, [0, 600], [0, -60]);
  const touch = useIsTouch();
  const stageRef = useRef(null);

  // The ticket leans toward the pointer as it crosses the stage, and can be
  // grabbed and flung; it springs back to true.
  const rx = useSpring(useMotionValue(0), { stiffness: 120, damping: 14 });
  const ry = useSpring(useMotionValue(0), { stiffness: 120, damping: 14 });
  function move(e) {
    if (touch || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 22);
    rx.set(-py * 18);
  }
  function leave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <div className="ticket-stage" ref={stageRef} onPointerMove={move} onPointerLeave={leave}>
      <motion.div
        className="big-ticket"
        style={{ y: yScroll, rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 30, rotateX: 12 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ ...SPRING, delay: 0.15 }}
        drag={!touch}
        dragSnapToOrigin
        dragElastic={0.18}
        dragConstraints={{ left: -60, right: 60, top: -40, bottom: 40 }}
        whileDrag={{ cursor: "grabbing", scale: 1.03 }}
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
      <div className="hero-photo" aria-hidden="true">
        <img src={IMG.booth} alt="" loading="lazy" />
      </div>
    </div>
  );
}

function Hero() {
  const lines = ["Pay at", "the gate."];
  return (
    <section className="hero">
      <img className="hero-paper" src={IMG.paper} alt="" aria-hidden="true" loading="lazy" />
      <div className="wrap">
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
                <div className="n"><CountUp to={8} /></div>
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

function Band({ img, kicker, title, sub }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-12%", "12%"]);
  return (
    <section className="band" ref={ref}>
      <motion.img src={img} alt="" loading="lazy" style={{ y, scale: 1.2 }} />
      <div className="wrap band-text">
        <Reveal>
          <div className="kicker">{kicker}</div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </Reveal>
      </div>
    </section>
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
              <div className="kicker" style={{ color: "#6fd39f" }}>
                The signature element <span className="sim-tag">Simulated</span>
              </div>
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
              <p className="demo-sim">
                Runs locally. No wallet, no chain, no funds move. The real proof is
                the live Atlantic test suite and a funded on-chain run.
              </p>
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

          <ProofPanel />

          <p className="demo-note">
            This shows one of the four gaps Tollgate closes. The full skill is{" "}
            <a href="#tools">eight tools across both sides</a>: selling, paying,
            sessions, receipts, and the bundled facilitator.
          </p>
        </div>
      </div>
    </section>
  );
}

// Verifies a real Tollgate payment live against the Atlantic RPC, in the
// visitor's browser. No wallet, no signing: a read-only confirmation that the
// settlement is real, plus a link to the explorer.
function ProofPanel() {
  const [state, setState] = useState({ status: "idle" });
  if (!PROOF_TX) return null;

  async function verify() {
    setState({ status: "checking" });
    try {
      const res = await fetch(ATLANTIC_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [PROOF_TX],
        }),
      });
      const json = await res.json();
      const r = json.result;
      if (!r) {
        setState({ status: "notfound" });
        return;
      }
      setState({
        status: r.status === "0x1" ? "confirmed" : "reverted",
        block: parseInt(r.blockNumber, 16),
      });
    } catch {
      setState({ status: "error" });
    }
  }

  const short = `${PROOF_TX.slice(0, 10)}...${PROOF_TX.slice(-8)}`;
  return (
    <div className="proof">
      <div className="proof-label">Real settlement on Atlantic</div>
      <div className="proof-row">
        <code className="proof-hash">{short}</code>
        <button className="btn btn-outline proof-btn" onClick={verify} disabled={state.status === "checking"}>
          {state.status === "checking" ? "Checking..." : "Verify on-chain"}
        </button>
        <a className="proof-link" href={`${PHAROSSCAN}/tx/${PROOF_TX}`} target="_blank" rel="noreferrer">
          PharosScan
        </a>
      </div>
      {state.status === "confirmed" && (
        <div className="proof-result ok">Confirmed in block {state.block.toLocaleString()}. This is a live on-chain payment, not the simulation above.</div>
      )}
      {state.status === "reverted" && <div className="proof-result bad">Transaction reverted.</div>}
      {state.status === "notfound" && <div className="proof-result bad">Not found on this RPC yet.</div>}
      {state.status === "error" && <div className="proof-result bad">RPC unreachable. Open PharosScan instead.</div>}
    </div>
  );
}

function Tools() {
  return (
    <section className="pad" id="tools" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <div>
            <div className="kicker">The surface</div>
            <h2 className="head">Eight tools. Two sides. One skill.</h2>
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
          <div className="code" style={{ marginBottom: 16 }}>
            <div><span className="m">npm install x402-merchant</span></div>
          </div>
        </Reveal>
        <Reveal>
          <div className="code">
            <div><span className="m">// add to your MCP client config</span></div>
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

const NAV_LINKS = [
  ["#why", "Why"],
  ["#demo", "Demo"],
  ["#tools", "Tools"],
  ["#start", "Install"],
];

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <span className="brand"><GateMark /> Tollgate</span>
        <div className="nav-links">
          {NAV_LINKS.map(([href, label]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </div>
        <div className="nav-right">
          <a className="nav-cta" href={SITE} target="_blank" rel="noreferrer">Live ledger</a>
          <button
            className={`nav-burger${open ? " open" : ""}`}
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            className="nav-sheet"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {NAV_LINKS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <ScrollProgress />
      <CustomCursor />
      <Nav />
      <Hero />
      <Marquee />
      <Gaps />
      <Band
        img={IMG.press}
        kicker="Infrastructure, not a demo"
        title="Payment rails an agent can run a business on."
        sub="Verify, settle, receipt, reconcile. The unglamorous machinery that turns a clever demo into a merchant that gets paid."
      />
      <Step0 />
      <Demo />
      <Tools />
      <Start />
      <Footer />
    </>
  );
}
