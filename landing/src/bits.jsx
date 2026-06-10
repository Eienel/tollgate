// Reusable motion primitives. The taste from Motion, Aceternity, and React
// Bits, rebuilt with real spring physics and held to the paper-and-ink look.

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "framer-motion";

export const SPRING = { type: "spring", stiffness: 120, damping: 18, mass: 0.9 };

// Decrypted text. Glyphs resolve into the final string, left to right, like a
// dot-matrix printer settling a ticket. Runs when scrolled into view.
const HEX = "0123456789abcdef";
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

export function Decrypt({ text, charset = "alnum", className, as: Tag = "span", duration = 700 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const [out, setOut] = useState(text);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView || reduce) {
      setOut(text);
      return;
    }
    const glyphs = charset === "hex" ? HEX : ALNUM;
    const start = performance.now();
    const per = duration / Math.max(text.length, 1);
    let raf;
    const tick = (now) => {
      const settled = Math.floor((now - start) / per);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (i < settled || c === " " || c === "." || c === "/" || c === ":") s += c;
        else s += glyphs[(Math.random() * glyphs.length) | 0];
      }
      setOut(s);
      if (settled < text.length) raf = requestAnimationFrame(tick);
      else setOut(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, text, charset, duration, reduce]);

  return (
    <Tag ref={ref} className={className}>
      {out}
    </Tag>
  );
}

// Magnetic. The element leans toward the cursor, then springs home.
export function Magnetic({ children, strength = 0.4, className, ...rest }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), SPRING);
  const y = useSpring(useMotionValue(0), SPRING);

  function move(e) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function leave() {
    x.set(0);
    y.set(0);
  }
  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ x, y, display: "inline-flex" }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// Tilt. A surface leans in 3D toward the cursor, with a faint paper sheen.
export function Tilt({ children, className, max = 9, base = 0 }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), SPRING);
  const ry = useSpring(useMotionValue(0), SPRING);

  function move(e) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 2 * max);
    rx.set(-py * 2 * max);
  }
  function leave() {
    rx.set(0);
    ry.set(0);
  }
  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ rotateX: rx, rotateY: ry, rotate: base, transformStyle: "preserve-3d" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Count up to a value when in view, with a small spring settle.
export function CountUp({ to, decimals = 0, prefix = "", suffix = "", className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setVal(to);
      return;
    }
    const start = performance.now();
    const dur = 1100;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      setVal(to * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setVal(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, reduce]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

// Reveal children with a staggered rise when scrolled into view.
export function Reveal({ children, className, delay = 0, y = 28 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
