// FlightTicket.jsx
// The hero showpiece. One SVG path morphs ticket -> envelope -> paper plane
// (Flubber interpolating the d attribute), the plane flies an arc through a
// toll gate leaving a drawn trail, then morphs back to the ticket. On loop.
//
// A single Framer MotionValue (progress 0..1, repeating) drives everything:
// the morph segment, the flight transform, the trail draw, and the gate glow.
// Under reduced motion it renders a still ticket.

import { useEffect, useMemo, useRef } from "react";
import { interpolate } from "flubber";
import {
  motion,
  useMotionValue,
  useTransform,
  useReducedMotion,
  animate,
} from "framer-motion";

// Shapes share one coordinate box (~64 wide, 40 tall) so the morph stays stable.
const TICKET = "M0,2 L64,2 L64,38 L0,38 Z";
const ENVELOPE = "M0,8 L0,38 L64,38 L64,8 L32,26 Z";
const PLANE = "M64,20 L0,8 L17,20 L0,32 Z";

const SEG = {
  toEnvelope: [0.0, 0.2],
  toPlane: [0.2, 0.36],
  fly: [0.36, 0.8],
  toTicket: [0.8, 1.0],
};

function seg(p, [a, b]) {
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}

export default function FlightTicket() {
  const reduce = useReducedMotion();
  const p = useMotionValue(0);

  const interps = useMemo(
    () => ({
      a: interpolate(TICKET, ENVELOPE, { maxSegmentLength: 3 }),
      b: interpolate(ENVELOPE, PLANE, { maxSegmentLength: 3 }),
      c: interpolate(PLANE, TICKET, { maxSegmentLength: 3 }),
    }),
    [],
  );

  useEffect(() => {
    if (reduce) return;
    const controls = animate(p, 1, {
      duration: 9,
      ease: "linear",
      repeat: Infinity,
    });
    return () => controls.stop();
  }, [reduce, p]);

  // The morphing d attribute.
  const d = useTransform(p, (v) => {
    if (v < SEG.toEnvelope[1]) return interps.a(seg(v, SEG.toEnvelope));
    if (v < SEG.toPlane[1]) return interps.b(seg(v, SEG.toPlane));
    if (v < SEG.fly[1]) return PLANE;
    return interps.c(seg(v, SEG.toTicket));
  });

  // Flight transform. Base near the left so there is room to cross the gate.
  const BX = 40;
  const BY = 78;
  const x = useTransform(
    p,
    [0, 0.36, 0.52, 0.66, 0.8, 1],
    [BX, BX, BX + 70, BX + 132, BX + 56, BX],
  );
  const y = useTransform(
    p,
    [0, 0.36, 0.52, 0.66, 0.8, 1],
    [BY, BY, BY - 26, BY - 10, BY - 30, BY],
  );
  const rotate = useTransform(
    p,
    [0, 0.36, 0.52, 0.66, 0.8, 1],
    [0, 0, -10, 6, -12, 0],
  );

  // The trail draws as the plane flies, then fades.
  const trailLen = useTransform(p, [0.36, 0.74], [0, 1]);
  const trailOpacity = useTransform(p, [0.36, 0.46, 0.74, 0.84], [0, 0.9, 0.9, 0]);

  // The gate brightens as the plane passes through it.
  const gateGlow = useTransform(p, [0.48, 0.56, 0.64], [0, 1, 0]);

  if (reduce) {
    return (
      <div className="flight-stage">
        <svg viewBox="0 0 260 180" className="flight-svg" aria-hidden="true">
          <g transform={`translate(${BX} ${BY})`}>
            <path d={TICKET} className="flight-shape" />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div className="flight-stage">
      <svg viewBox="0 0 260 180" className="flight-svg" role="img" aria-label="A toll ticket becomes a paper plane, flies through the gate, and returns.">
        {/* The gate, right of center. */}
        <g className="flight-gate">
          <motion.path
            d="M196,40 L196,150 M236,40 L236,150 M188,44 L244,44"
            style={{ opacity: useTransform(gateGlow, (g) => 0.5 + g * 0.5) }}
          />
          <motion.path
            d="M196,40 L196,150 M236,40 L236,150 M188,44 L244,44"
            className="flight-gate-hot"
            style={{ opacity: gateGlow }}
          />
        </g>

        {/* The flight trail, drawn behind the object. */}
        <motion.path
          className="flight-trail"
          d="M86,100 C120,72 168,66 214,82"
          style={{ pathLength: trailLen, opacity: trailOpacity }}
        />

        {/* The morphing object. x, y, rotate are motion values so Framer emits a
            valid SVG transform; rotation is about the shape's center. */}
        <motion.g style={{ x, y, rotate, originX: "32px", originY: "20px" }}>
          <motion.path d={d} className="flight-shape" />
        </motion.g>
      </svg>
    </div>
  );
}
