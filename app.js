// app.js (complete) — v30
// TrigBend — Offset
//
// Goals implemented:
// 1) Tangent-to-tangent straight segment highlighted brown.
// 2) Layout start mark + direction arrow shown at first tangent (T1) for layout direction.
// 3) Better use of screen space via AUTO-FIT scaling (pipe no longer stretches across unused area).
// 4) Flip orientation (X-axis baseline or Y-axis baseline) + Angle/Offset both editable + lockable.
//
// Interaction:
// - Drag pipe left/right to change Between Bends (L).
// - Tap Angle to set Angle AND lock Angle.
// - Tap Offset to set Offset AND lock Offset.
// - Tap Between Bends to set L (does not change lock mode).
// - Tap Flip to rotate the whole layout (QuickBend-like vertical option).
//
// Constraints (CLR-aware):
// - If locked offset is impossible for current L+CLR (requires >89°), offset caps down.
// - Prevent bend overlap (QuickBend “bend into previous bend radius”): if overlap, L caps up.

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
const ttSegment = document.getElementById("ttSegment");
const pipeHit = document.getElementById("pipeHit");
const baseline = document.getElementById("baseline");

const c1El = document.getElementById("c1");
const c2El = document.getElementById("c2");
const t1El = document.getElementById("t1");
const t2El = document.getElementById("t2");
const handleEl = document.getElementById("handle");

const startTick = document.getElementById("startTick");
const dirArrow = document.getElementById("dirArrow");

const mLineL = document.getElementById("mLineL");
const mTextL = document.getElementById("mTextL");

const hudTitle = document.getElementById("hudTitle");
const hudFlip = document.getElementById("hudFlip");
const hudAngle = document.getElementById("hudAngle");
const hudOffset = document.getElementById("hudOffset");
const hudSpacing = document.getElementById("hudSpacing");
const hudShrink = document.getElementById("hudShrink");

const labelHelp = document.getElementById("labelHelp");

const infoG = document.getElementById("info");
const infoTitle = document.getElementById("infoTitle");
const infoBody = document.getElementById("infoBody");
const infoBody2 = document.getElementById("infoBody2");
const infoBody3 = document.getElementById("infoBody3");
const infoClose = document.getElementById("infoClose");

// ----------------- Core parameters -----------------
let R_in = 6.0; // CLR (hidden for now; later from bender select)

// These are user-facing values
let L_in = 12.0;          // Between Bends
let offset_in = 6.0;      // Offset value shown
let thetaDeg = 22.5;      // Angle value shown

// Lock mode: "offset" or "angle"
let lockMode = "offset";  // default

// Orientation: "x" (baseline horizontal), "y" (baseline vertical)
let orient = "x";

// Drawing-only lead-in/out (inches)
const LEAD_IN_IN = 4;
const LEAD_OUT_IN = 4;

// Constraint tuning
const THETA_MIN_DEG = 0.1;
const THETA_MAX_DEG = 89.0;
const OVERLAP_CLEARANCE_IN = 0.25;

// Auto-fit scaling bounds
const PX_PER_IN_MIN = 7;
const PX_PER_IN_MAX = 18;
let PX_PER_IN = 12; // auto-adjusted (do not treat as a user control)

// Viewport constants
const VIEW_W = 900;
const VIEW_H = 520;
const MARGIN = 48;

// ----------------- Math helpers -----------------
const deg2rad = (d) => d * Math.PI / 180;
const rad2deg = (r) => r * 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rot(v, ang){
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: v.x*c - v.y*s, y: v.x*s + v.y*c };
}
function add(a,b){ return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a,b){ return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a,k){ return { x: a.x * k, y: a.y * k }; }
function mag(v){ return Math.hypot(v.x, v.y); }
function fmt(n, digits=2){ return Number.isFinite(n) ? n.toFixed(digits) : "—"; }

function xform(p){
  // Optional flip: rotate math space so baseline aligns with Y axis.
  // "x": identity (baseline horizontal).
  // "y": rotate +90° so baseline becomes vertical.
  if (orient === "x") return p;
  // rotate about origin: (x,y) -> (y, -x)
  return { x: p.y, y: -p.x };
}

// Dynamic centering offsets in math-pixel space
let centerShift = { x: 0, y: 0 };
function baselineY(){ return Math.round(VIEW_H * 0.62); }

function toScreen(pMathPx){
  const p = add(xform(pMathPx), centerShift);
  return { x: p.x, y: baselineY() - p.y };
}

function setCircle(el, pMathPx){
  const p = toScreen(pMathPx);
  el.setAttribute("cx", p.x);
  el.setAttribute("cy", p.y);
}

function setLine(el, aMathPx, bMathPx){
  const a = toScreen(aMathPx), b = toScreen(bMathPx);
  el.setAttribute("x1", a.x);
  el.setAttribute("y1", a.y);
  el.setAttribute("x2", b.x);
  el.setAttribute("y2", b.y);
}

function arcCmd(startMathPx, endMathPx, sweepCCW){
  const s = toScreen(startMathPx);
  const e = toScreen(endMathPx);
  const rPx = R_in * PX_PER_IN;
  const largeArc = 0;
  // y-down flip: math CCW becomes SVG sweep=0
  const sweep = sweepCCW ? 0 : 1;
  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

// ----------------- Core equations -----------------
function offsetForTheta(thetaRad, Ltest){
  // H = L*sinθ + 2R*(1 - cosθ)
  return (Ltest * Math.sin(thetaRad)) + 2 * R_in * (1 - Math.cos(thetaRad));
}

function maxOffsetForL(Ltest){
  return offsetForTheta(deg2rad(THETA_MAX_DEG), Ltest);
}

function solveThetaForOffset(targetH, Ltest){
  const lo = deg2rad(THETA_MIN_DEG);
  const hi = deg2rad(THETA_MAX_DEG);
  const hLo = offsetForTheta(lo, Ltest);
  const hHi = offsetForTheta(hi, Ltest);

  if (targetH <= hLo) return { thetaDeg: THETA_MIN_DEG, capped: true, reason: "Offset capped to minimum." };
  if (targetH >= hHi) return { thetaDeg: THETA_MAX_DEG, capped: true, reason: "Offset capped: not achievable for this L + CLR." };

  let a = lo, b = hi;
  for (let i=0;i<28;i++){
    const mid = (a+b)/2;
    const h = offsetForTheta(mid, Ltest);
    if (h > targetH) b = mid;
    else a = mid;
  }
  return { thetaDeg: rad2deg((a+b)/2), capped: false, reason: "" };
}

function centersInInches(thetaRad, Ltest){
  // place T1 at origin in inch-space
  const T1 = { x: 0, y: 0 };
  const dir0 = { x: 1, y: 0 };

  const C1 = { x: 0, y
