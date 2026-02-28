// app.js (complete) — v56
// TrigBend — Offset
//
// v54 changes:
// - Removed pipe decorations (baseline, tick, arrow, dimension lines)
// - Orange shading over bend arcs only (arc to arc)
// - M1/M2 marks at CENTER of each arc (bend marks)
// - Between Bends now shows CENTER-TO-CENTER (L + R·θ)
// - "Both Locked" mode: entering both angle AND offset locks both, solves for L
// - Adjacent is now lockable: tap to enter, locks horizontal run

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
const ttSegment = document.getElementById("ttSegment");
const pipeHit = document.getElementById("pipeHit");

const m1El = document.getElementById("m1");
const m2El = document.getElementById("m2");
const m1TickEl = document.getElementById("m1Tick");
const m2TickEl = document.getElementById("m2Tick");
const startArrowEl = document.getElementById("startArrow");
const tpE1El = document.getElementById("tpE1");
const tpE2El = document.getElementById("tpE2");

const handleEl = document.getElementById("handle");

const hudTitle = document.getElementById("hudTitle");
const keyAngle = document.getElementById("keyAngle");
const keyOffset = document.getElementById("keyOffset");
const keyAdjacent = document.getElementById("keyAdjacent");
const cardBgAngle  = document.getElementById("cardBgAngle");
const cardBgOffset = document.getElementById("cardBgOffset");
const cardBgAdjacent = document.getElementById("cardBgAdjacent");
const hudAngle = document.getElementById("hudAngle");
const hudOffset = document.getElementById("hudOffset");
const hudSpacing = document.getElementById("hudSpacing");
const hudShrink = document.getElementById("hudShrink");
const hudAdjacentVal = document.getElementById("hudAdjacentVal");
const labelHelp = document.getElementById("labelHelp");

const infoG = document.getElementById("info");
const infoTitle = document.getElementById("infoTitle");
const infoBody = document.getElementById("infoBody");
const infoBody2 = document.getElementById("infoBody2");
const infoBody3 = document.getElementById("infoBody3");
const infoClose = document.getElementById("infoClose");

// ---------- Geometry / UI state ----------
let R_in = 5.75; // CLR — 1/2" EMT (Greenlee 1818)

let L_in = 12.0;      // Between bends (tangent-to-tangent along sloped segment)
let offset_in = 6.0;  // Target/actual offset (centerline)
let thetaDeg = 22.5;  // Bend angle per bend

// Lock flags — any combination can be set
let anglePinned    = false; // user has explicitly set angle
let offsetPinned   = true;  // user has explicitly set offset (default)
let adjacentPinned = false; // user has explicitly set adjacent

let adjacent_in = 0;        // target adjacent when adjacentPinned
let lastAdjacentIn = 0;     // last computed adjacent (for input prompt)

// ---------- Derived lock mode label ----------
function lockLabel(){
  if (adjacentPinned) return "ADJACENT LOCKED";
  if (anglePinned && offsetPinned) return "BOTH LOCKED";
  if (anglePinned)  return "ANGLE LOCKED";
  if (offsetPinned) return "OFFSET LOCKED";
  return "OFFSET MODE";
}

// drawing-only (inches)
const LEAD_IN_IN = 4;
const LEAD_OUT_IN = 4;

// limits / constraints
const THETA_MIN_DEG = 0.1;
const THETA_MAX_DEG = 89.0;
const OVERLAP_CLEARANCE_IN = 0.25;

// auto-fit scale — conduit always in left 240px column
const VIEW_W = 500;
const VIEW_H = 820;
const MARGIN = 16;
const COL_W  = 240;
const DRAW_CENTER_X_Y = 115;
const DRAW_CENTER_Y   = 420;
const PX_PER_IN_MIN = 2;
const PX_PER_IN_MAX = 32;
let PX_PER_IN = 14;

let shiftPx = { x: 0, y: 0 };

// ---------- Math helpers ----------
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
function norm(v){ const m = mag(v) || 1; return { x: v.x/m, y: v.y/m }; }
function fmt(n, d=2){ return Number.isFinite(n) ? n.toFixed(d) : "—"; }

// Display inches as ruler fractions to the nearest 1/16"
// e.g.  6.5 → 6 1/2"   11.9375 → 11 15/16"   14.0 → 1' 2"
function gcd(a, b){ return b === 0 ? a : gcd(b, a % b); }
function fmtRuler(decIn){
  if (!Number.isFinite(decIn)) return "—";
  const neg = decIn < 0;
  let sixteenths = Math.round(Math.abs(decIn) * 16);
  const wholeIn = Math.floor(sixteenths / 16);
  const fracSix = sixteenths % 16;
  let fracStr = "";
  if (fracSix !== 0){
    const g = gcd(fracSix, 16);
    fracStr = ` ${fracSix/g}/${16/g}`;
  }
  return `${neg ? "-" : ""}${wholeIn}${fracStr}"`;
}

// orient is always "y": rotate +90° so pipe runs top→bottom in screen
function orientXformIn(pIn){
  return { x: pIn.y, y: -pIn.x };
}

function toScreenFromIn(pIn){
  const p = orientXformIn(pIn);
  const xpx = p.x * PX_PER_IN + shiftPx.x;
  const ypx = p.y * PX_PER_IN + shiftPx.y;
  return { x: xpx, y: DRAW_CENTER_Y - ypx };
}

function setLineIn(el, aIn, bIn){
  const a = toScreenFromIn(aIn), b = toScreenFromIn(bIn);
  el.setAttribute("x1", a.x);
  el.setAttribute("y1", a.y);
  el.setAttribute("x2", b.x);
  el.setAttribute("y2", b.y);
}

function setCircleIn(el, pIn){
  const p = toScreenFromIn(pIn);
  el.setAttribute("cx", p.x);
  el.setAttribute("cy", p.y);
}

function arcCmdIn(startIn, endIn, sweepCCW){
  const s = toScreenFromIn(startIn);
  const e = toScreenFromIn(endIn);
  const rPx = R_in * PX_PER_IN;
  const largeArc = 0;
  const sweep = sweepCCW ? 0 : 1; // y-down flip
  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

// ---------- Core equations ----------
function offsetForTheta(thetaRad, Ltest){
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

  if (targetH <= hLo) return { thetaDeg: THETA_MIN_DEG, capped: true };
  if (targetH >= hHi) return { thetaDeg: THETA_MAX_DEG, capped: true };

  let a = lo, b = hi;
  for (let i=0;i<28;i++){
    const mid = (a+b)/2;
    if (offsetForTheta(mid, Ltest) > targetH) b = mid;
    else a = mid;
  }
  return { thetaDeg: rad2deg((a+b)/2), capped: false };
}

// Given adjacent and theta, solve for L
function LfromAdjacentAndTheta(adj, thetaRad){
  const cosT = Math.cos(thetaRad);
  if (Math.abs(cosT) < 1e-9) return 240;
  return (adj - 2*R_in*Math.sin(thetaRad)) / cosT;
}

// Given angle and offset, solve for L
function LfromAngleAndOffset(thetaRad, targetOffset){
  const sinT = Math.sin(thetaRad);
  if (Math.abs(sinT) < 1e-9) return 240;
  return (targetOffset - 2*R_in*(1-Math.cos(thetaRad))) / sinT;
}

function centersInInches(thetaRad, Ltest){
  const T1 = { x: 0, y: 0 };
  const dir0 = { x: 1, y: 0 };
  const C1 = { x: 0, y: R_in };

  const v1s = { x: 0, y: -R_in };
  const v1e = rot(v1s, thetaRad);
  const E1 = add(C1, v1e);
  const dir1 = rot(dir0, thetaRad);

  const T2 = add(E1, mul(dir1, Ltest));

  const rightN = { x: Math.sin(thetaRad), y: -Math.cos(thetaRad) };
  const C2 = add(T2, mul(rightN, R_in));

  return { C1, C2, T1, E1, T2 };
}

function overlaps(thetaRad, Ltest){
  const { C1, C2 } = centersInInches(thetaRad, Ltest);
  const d = mag(sub(C2, C1));
  return d < (2*R_in) + OVERLAP_CLEARANCE_IN;
}

function findMinFeasibleL_forOffset(targetOffset){
  let Llo = 0.25;
  let Lhi = Math.max(L_in, 1);

  for (let i=0;i<24;i++){
    const maxH = maxOffsetForL(Lhi);
    const usedOffset = Math.min(targetOffset, maxH);
    const sol = solveThetaForOffset(usedOffset, Lhi);
    const th = deg2rad(sol.thetaDeg);
    if (!overlaps(th, Lhi)) break;
    Lhi *= 1.4;
    if (Lhi > 240) break;
  }

  for (let i=0;i<28;i++){
    const mid = (Llo + Lhi)/2;
    const maxH = maxOffsetForL(mid);
    const usedOffset = Math.min(targetOffset, maxH);
    const sol = solveThetaForOffset(usedOffset, mid);
    const th = deg2rad(sol.thetaDeg);
    if (!overlaps(th, mid)) Lhi = mid;
    else Llo = mid;
  }
  return Lhi;
}

function findMinFeasibleL_forAngle(thetaRad){
  let Llo = 0.0;
  let Lhi = Math.max(L_in, 1);

  for (let i=0;i<24;i++){
    if (!overlaps(thetaRad, Lhi)) break;
    Lhi *= 1.4;
    if (Lhi > 240) break;
  }

  for (let i=0;i<28;i++){
    const mid = (Llo + Lhi)/2;
    if (!overlaps(thetaRad, mid)) Lhi = mid;
    else Llo = mid;
  }
  return Math.max(Lhi, 0.25);
}

// ---------- Auto-fit ----------
function computeAutoFitScaleAndShift(allPtsIn, extraRadiusIn){
  const pts = allPtsIn.map(orientXformIn);

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts){
    minx = Math.min(minx, p.x - extraRadiusIn);
    miny = Math.min(miny, p.y - extraRadiusIn);
    maxx = Math.max(maxx, p.x + extraRadiusIn);
    maxy = Math.max(maxy, p.y + extraRadiusIn);
  }

  const wIn = Math.max(1e-6, maxx - minx);
  const hIn = Math.max(1e-6, maxy - miny);

  const availW = COL_W - 2*MARGIN;
  const availH = VIEW_H - 2*MARGIN;

  const sx = availW / wIn;
  const sy = availH / hIn;
  PX_PER_IN = clamp(Math.min(sx, sy), PX_PER_IN_MIN, PX_PER_IN_MAX);

  const cx = (minx + maxx)/2;
  const cy = (miny + maxy)/2;

  shiftPx = {
    x: DRAW_CENTER_X_Y - (cx * PX_PER_IN),
    y: 0 - (cy * PX_PER_IN)
  };
}

// ---------- Constraint enforcement ----------
let lastStatus = "";

function enforceConstraints(){
  lastStatus = "";

  if (adjacentPinned) {
    // Adjacent is locked. Keep current theta, solve for L from adjacent+theta.
    // If offset is also pinned: numerically solve for theta first.
    const th = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));

    if (offsetPinned) {
      // Two equations: offset = f(L,θ), adjacent = g(L,θ). Solve numerically for θ.
      // adjacent = 2R·sinθ + L·cosθ  and  offset = L·sinθ + 2R·(1-cosθ)
      // From adjacent: L = (adj - 2R·sinθ)/cosθ
      // Substitute into offset: offset = ((adj-2R·sinθ)/cosθ)·sinθ + 2R·(1-cosθ)
      // Solve for θ numerically.
      let lo = deg2rad(THETA_MIN_DEG), hi = deg2rad(THETA_MAX_DEG);
      const f = (t) => {
        const sinT = Math.sin(t), cosT = Math.cos(t);
        if (Math.abs(cosT) < 1e-9) return 1e9;
        const Ltest = (adjacent_in - 2*R_in*sinT) / cosT;
        return offsetForTheta(t, Ltest) - offset_in;
      };
      // Check if solvable
      const flo = f(lo), fhi = f(hi);
      if (flo * fhi > 0){
        // Not solvable with both constraints — relax offset pin
        offsetPinned = false;
        lastStatus = "CAPPED: Cannot satisfy both offset and adjacent — offset unlocked.";
      } else {
        for (let i=0;i<32;i++){
          const mid = (lo+hi)/2;
          if (f(mid)*flo > 0) lo = mid; else hi = mid;
        }
        const solvedTh = (lo+hi)/2;
        thetaDeg = clamp(rad2deg(solvedTh), THETA_MIN_DEG, THETA_MAX_DEG);
        const th2 = deg2rad(thetaDeg);
        L_in = clamp(LfromAdjacentAndTheta(adjacent_in, th2), 0.25, 240);
        offset_in = offsetForTheta(th2, L_in);
      }
    }

    if (!offsetPinned) {
      // Only adjacent pinned. Keep current theta, solve for L.
      const th2 = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));
      L_in = clamp(LfromAdjacentAndTheta(adjacent_in, th2), 0.25, 240);
      if (overlaps(th2, L_in)){
        L_in = findMinFeasibleL_forAngle(th2);
        // Recompute adjacent from new L
        adjacent_in = 2*R_in*Math.sin(th2) + L_in*Math.cos(th2);
        lastStatus = "CAPPED: Bends overlap — adjacent adjusted.";
      }
      offset_in = offsetForTheta(th2, L_in);
    }

    return;
  }

  // --- No adjacent pin ---

  if (anglePinned && offsetPinned) {
    // Both angle and offset locked — solve for L.
    const th = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));
    L_in = LfromAngleAndOffset(th, offset_in);
    L_in = clamp(L_in, 0.25, 240);
    if (L_in <= 0.25 && offsetForTheta(th, 0.25) < offset_in){
      // Capped low
      offset_in = offsetForTheta(th, 0.25);
      lastStatus = "CAPPED: Offset too high for this angle — offset adjusted.";
    } else if (overlaps(th, L_in)){
      L_in = findMinFeasibleL_forAngle(th);
      offset_in = offsetForTheta(th, L_in);
      lastStatus = "CAPPED: Bends overlap — between bends adjusted.";
    }
    return;
  }

  if (anglePinned) {
    // Only angle locked — compute offset from L and theta.
    const th = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));
    thetaDeg = rad2deg(th);
    offset_in = offsetForTheta(th, L_in);
    if (overlaps(th, L_in)){
      L_in = findMinFeasibleL_forAngle(th);
      offset_in = offsetForTheta(th, L_in);
      lastStatus = "CAPPED: Bends overlap — between bends adjusted.";
    }
    return;
  }

  // offsetPinned or default — solve angle from offset and L.
  {
    const maxH = maxOffsetForL(L_in);
    if (offset_in > maxH){
      offset_in = maxH;
      lastStatus = "CAPPED: Offset too high for this Between Bends + CLR.";
    }
    const sol = solveThetaForOffset(offset_in, L_in);
    thetaDeg = sol.thetaDeg;
    const th = deg2rad(thetaDeg);
    if (overlaps(th, L_in)){
      const minL = findMinFeasibleL_forOffset(offset_in);
      if (minL > L_in + 1e-6) L_in = minL;
      const maxH2 = maxOffsetForL(L_in);
      if (offset_in > maxH2) offset_in = maxH2;
      thetaDeg = solveThetaForOffset(offset_in, L_in).thetaDeg;
      lastStatus = "CAPPED: Bends overlap — between bends adjusted.";
    }
  }
}

// Between bends — traditional trig multiplier method: offset / sin(θ)
// For 30°: multiplier = 1/sin(30°) = 2.000 exactly → between bends = 2 × offset
function centerToCenterIn(){
  const sinT = Math.sin(deg2rad(thetaDeg));
  return sinT < 1e-9 ? 0 : offset_in / sinT;
}

function buildGeometryInInches(){
  enforceConstraints();

  const th = deg2rad(thetaDeg);

  const T1 = { x: 0, y: 0 };
  const dir0 = { x: 1, y: 0 };

  const C1 = { x: 0, y: R_in };

  const v1s = { x: 0, y: -R_in };
  const v1e = rot(v1s, th);
  const E1 = add(C1, v1e);

  const dir1 = rot(dir0, th);
  const T2 = add(E1, mul(dir1, L_in));

  const rightN = { x: Math.sin(th), y: -Math.cos(th) };
  const C2 = add(T2, mul(rightN, R_in));

  const v2s = mul(rightN, -R_in);
  const v2e = rot(v2s, -th);
  const E2 = add(C2, v2e);

  const START = add(T1, { x: -LEAD_IN_IN, y: 0 });
  const END   = add(E2, { x:  LEAD_OUT_IN, y: 0 });

  // M1 = start of first arc (arrow / start mark — bender arrow aligns here)
  const M1 = T1; // {x:0, y:0}
  // M2 = start of second arc (second bend mark)
  const M2 = T2;

  // Perpendicular to pipe at each mark (for tick lines)
  // At T1: pipe direction = dir0 = {x:1,y:0}  → perp = {x:0, y:1}
  const normM1 = { x: 0, y: 1 };
  // At T2: pipe direction = dir1 = rot(dir0, th) → perp = {x:-sin(th), y:cos(th)}
  const normM2 = { x: -dir1.y, y: dir1.x };

  // shrink = L(1−cosθ) + 2R(θ−sinθ)
  const shrink = L_in * (1 - Math.cos(th)) + 2 * R_in * (th - Math.sin(th));
  // adjacent = horizontal run of offset = 2R·sinθ + L·cosθ
  const adjacent = 2 * R_in * Math.sin(th) + L_in * Math.cos(th);

  return { START, T1, C1, E1, T2, C2, E2, END, M1, M2, normM1, normM2, shrink, adjacent };
}

// ---------- Rendering ----------
function render(){
  const g = buildGeometryInInches();

  computeAutoFitScaleAndShift(
    [g.START, g.T1, g.C1, g.E1, g.T2, g.C2, g.E2, g.END],
    R_in
  );

  const S    = toScreenFromIn(g.START);
  const T1s  = toScreenFromIn(g.T1);
  const T2s  = toScreenFromIn(g.T2);
  const ENDs = toScreenFromIn(g.END);

  // Main pipe path
  const d = [
    `M ${S.x} ${S.y}`,
    `L ${T1s.x} ${T1s.y}`,
    arcCmdIn(g.T1, g.E1, true),
    `L ${T2s.x} ${T2s.y}`,
    arcCmdIn(g.T2, g.E2, false),
    `L ${ENDs.x} ${ENDs.y}`,
  ].join(" ");

  pipe.setAttribute("d", d);
  pipeHit.setAttribute("d", d);

  // Orange shading — arc portions only (T1→E1 and T2→E2)
  ttSegment.setAttribute("d", [
    `M ${T1s.x} ${T1s.y}`,
    arcCmdIn(g.T1, g.E1, true),
    `M ${T2s.x} ${T2s.y}`,
    arcCmdIn(g.T2, g.E2, false),
  ].join(" "));

  // drag handle at midpoint of T1→T2 diagonal
  const midT = { x: (g.T1.x + g.T2.x) / 2, y: (g.T1.y + g.T2.y) / 2 };
  setCircleIn(handleEl, midT);

  // Bend center marks M1 and M2
  setCircleIn(m1El, g.M1);
  setCircleIn(m2El, g.M2);

  // Tick marks at M1 (=T1) and M2 (=T2), perpendicular to pipe
  const tickLen = 0.55; // inches
  setLineIn(m1TickEl,
    add(g.M1, mul(g.normM1, -tickLen)),
    add(g.M1, mul(g.normM1,  tickLen))
  );
  setLineIn(m2TickEl,
    add(g.M2, mul(g.normM2, -tickLen)),
    add(g.M2, mul(g.normM2,  tickLen))
  );

  // Tangent-point markers at E1 and E2 (end of each arc)
  setCircleIn(tpE1El, g.E1);
  setCircleIn(tpE2El, g.E2);

  // Arrow mark at T1 — triangle pointing in the pipe direction (downward on screen)
  // pipe direction at T1 (dir0={x:1,y:0}) maps to screen-down after orientation transform
  {
    const o = toScreenFromIn(g.T1);
    const sz = 9;
    startArrowEl.setAttribute("points",
      `${o.x},${o.y + sz} ` +
      `${o.x - sz * 0.65},${o.y - sz * 0.45} ` +
      `${o.x + sz * 0.65},${o.y - sz * 0.45}`
    );
  }

  // ── Card highlight ──
  const LOCKED_CARD_BG   = "rgba(8,70,150,0.65)";
  const ADJ_CARD_BG      = "rgba(8,100,60,0.65)";
  const BOTH_CARD_BG     = "rgba(80,20,140,0.65)";
  const NORMAL_CARD_BG   = "rgba(14,22,38,0.90)";
  const lockedLabelClr   = "rgba(120,220,255,0.95)";
  const adjLabelClr      = "rgba(80,255,160,0.95)";
  const bothLabelClr     = "rgba(220,150,255,0.95)";
  const unlockedLabelClr = "rgba(255,255,255,0.55)";

  const bothActive = anglePinned && offsetPinned && !adjacentPinned;

  cardBgAngle.setAttribute("fill",
    adjacentPinned ? NORMAL_CARD_BG :
    bothActive     ? BOTH_CARD_BG   :
    anglePinned    ? LOCKED_CARD_BG : NORMAL_CARD_BG);

  cardBgOffset.setAttribute("fill",
    adjacentPinned ? NORMAL_CARD_BG :
    bothActive     ? BOTH_CARD_BG   :
    offsetPinned   ? LOCKED_CARD_BG : NORMAL_CARD_BG);

  cardBgAdjacent.setAttribute("fill",
    adjacentPinned ? ADJ_CARD_BG : NORMAL_CARD_BG);

  keyAngle.setAttribute("fill",
    adjacentPinned ? unlockedLabelClr :
    bothActive     ? bothLabelClr     :
    anglePinned    ? lockedLabelClr   : unlockedLabelClr);

  keyOffset.setAttribute("fill",
    adjacentPinned ? unlockedLabelClr :
    bothActive     ? bothLabelClr     :
    offsetPinned   ? lockedLabelClr   : unlockedLabelClr);

  keyAdjacent.setAttribute("fill",
    adjacentPinned ? adjLabelClr : unlockedLabelClr);

  hudTitle.textContent = lockLabel();
  lastAdjacentIn = g.adjacent;
  hudAngle.textContent       = `${fmt(thetaDeg,1)}°`;
  hudOffset.textContent      = fmtRuler(offset_in);
  hudSpacing.textContent     = fmtRuler(centerToCenterIn());
  hudShrink.textContent      = fmtRuler(g.shrink);
  hudAdjacentVal.textContent = fmtRuler(g.adjacent);

  if (!lastStatus){
    if (adjacentPinned && anglePinned)
      lastStatus = "Adjacent + Angle locked — tap a card to change.";
    else if (anglePinned && offsetPinned)
      lastStatus = "Both locked — drag to release angle and adjust spacing.";
    else
      lastStatus = "Drag pipe left/right to change offset. Tap cards to lock.";
  }
  labelHelp.textContent = lastStatus;
}

// ---------- Info drawer ----------
const explain = {
  angle: {
    title: "Angle (tap to lock)",
    body: "Multiplier = 1/sin(θ).  30°→2.000  22.5°→2.613  45°→1.414",
    body2: "Enter angle + offset together to lock both — spacing solves.",
    body3: "Angle is capped to < 90°."
  },
  offset: {
    title: "Offset (tap to lock)",
    body: "Locks the vertical rise (centerline) of the offset.",
    body2: "Enter offset + angle together to lock both — L solves automatically.",
    body3: "If impossible (or overlap), values cap to realistic limits."
  },
  spacing: {
    title: "Between Bends — multiplier method",
    body: "Mark spacing = Offset ÷ sin(θ)  =  Offset × multiplier.",
    body2: "30° multiplier = 2.000 exactly → between bends = 2× offset.",
    body3: "Tap to enter. Drag pipe left/right to change offset live."
  },
  shrink: {
    title: "Shrink",
    body: "Horizontal run lost to the offset geometry.",
    body2: "Subtract from your straight-run dimension when marking layout.",
    body3: "Formula: L(1−cosθ) + 2R(θ−sinθ)."
  },
  adjacent: {
    title: "Adjacent (tap to lock)",
    body: "Horizontal span of the offset — useful for limited-space bends.",
    body2: "Locks the horizontal run. Current angle is kept; L auto-solves.",
    body3: "Drag to adjust angle while adjacent stays fixed."
  },
  capped: {
    title: "Why it capped",
    body: "Two reasons:",
    body2: "1) Offset too high for current Between Bends + CLR (needs >89°), or",
    body3: "2) Bends overlap (second bend would start inside first bend radius)."
  }
};

function openInfo(key){
  const e = explain[key];
  infoTitle.textContent = e.title;
  infoBody.textContent  = e.body;
  infoBody2.textContent = e.body2;
  infoBody3.textContent = e.body3;
  infoG.setAttribute("visibility","visible");
}
function closeInfo(){
  infoG.setAttribute("visibility","hidden");
}
infoClose.addEventListener("click", closeInfo);

// ---------- Custom input overlay ----------
const inputOverlay = document.getElementById("inputOverlay");
const inputLabel   = document.getElementById("inputLabel");
const inputField   = document.getElementById("inputField");
const inputOk      = document.getElementById("inputOk");
const inputCancel  = document.getElementById("inputCancel");

let _inputResolve = null;

function showInput(labelText, currentVal){
  return new Promise((resolve) => {
    _inputResolve = resolve;
    inputLabel.textContent = labelText;
    inputField.value = currentVal;
    inputOverlay.classList.remove("hidden");
    setTimeout(() => { inputField.focus(); inputField.select(); }, 80);
  });
}

function _closeInput(value){
  inputOverlay.classList.add("hidden");
  inputField.blur();
  if (_inputResolve) { _inputResolve(value); _inputResolve = null; }
}

inputOk.addEventListener("click", () => _closeInput(inputField.value));
inputCancel.addEventListener("click", () => _closeInput(null));
inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter") _closeInput(inputField.value);
  if (e.key === "Escape") _closeInput(null);
});
inputOverlay.addEventListener("click", (e) => {
  if (e.target === inputOverlay) _closeInput(null);
});

// ---------- HUD interactions ----------
hudAngle.addEventListener("click", async ()=>{
  openInfo("angle");
  const v = await showInput("Angle (°)", thetaDeg.toFixed(1));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return;
  thetaDeg = clamp(n, THETA_MIN_DEG, THETA_MAX_DEG);
  anglePinned = true;
  adjacentPinned = false;
  // If offset was already pinned → both locked (L will solve)
  // If not → angle-only mode
  render();
});

hudOffset.addEventListener("click", async ()=>{
  openInfo("offset");
  const v = await showInput("Offset (inches)", offset_in.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  offset_in = clamp(n, 0.1, 240);
  offsetPinned = true;
  adjacentPinned = false;
  // If angle was already pinned → both locked (L will solve)
  // If not → offset-only mode
  render();
});

hudSpacing.addEventListener("click", async ()=>{
  openInfo("spacing");
  const v = await showInput("Between Bends — offset × 1/sin(θ) (inches)", centerToCenterIn().toFixed(2));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  // between_bends = offset / sin(θ)  →  offset = between_bends × sin(θ)
  const sinT = Math.sin(deg2rad(thetaDeg));
  if (sinT < 1e-9) return;
  offset_in = clamp(n * sinT, 0.1, 240);
  offsetPinned = true;
  if (anglePinned) anglePinned = false; // entering BB releases angle lock
  adjacentPinned = false;
  render();
});

hudShrink.addEventListener("click", ()=>openInfo("shrink"));
hudTitle.addEventListener("click", ()=>openInfo("capped"));

document.getElementById("hudAdjacent").addEventListener("click", async ()=>{
  openInfo("adjacent");
  const v = await showInput("Adjacent — horizontal run (inches)", lastAdjacentIn.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  adjacent_in = clamp(n, 0.1, 240);
  adjacentPinned = true;
  // Keep current angle when locking adjacent
  anglePinned = true;
  offsetPinned = false;
  render();
});

// ---------- Dragging ----------
let dragging = false;
let dragStart = null;

function getSvgPoint(evt){
  const pt = svg.createSVGPoint();
  const t = (evt.touches && evt.touches[0]) ? evt.touches[0] : evt;
  pt.x = t.clientX;
  pt.y = t.clientY;
  const ctm = svg.getScreenCTM();
  return pt.matrixTransform(ctm.inverse());
}

function onDown(e){
  // If adjacent+angle both locked, no drag
  if (adjacentPinned && anglePinned) return;

  const p = getSvgPoint(e);
  dragging = true;

  // "Both locked" mode: drag releases angle pin, switches to offset-only
  if (anglePinned && offsetPinned && !adjacentPinned){
    anglePinned = false;
  }

  dragStart = {
    x: p.x, y: p.y,
    L_in, offset_in,
    thetaDeg,
    pxPerIn: PX_PER_IN,
    adjacentPinned
  };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e){
  if (!dragging || !dragStart) return;
  const p = getSvgPoint(e);

  if (dragStart.adjacentPinned){
    // Adjacent locked: vertical drag changes angle (adjacent stays, L recomputes)
    const delta = dragStart.y - p.y; // upward → larger angle
    const dTheta = delta * 0.3;
    thetaDeg = clamp(dragStart.thetaDeg + dTheta, THETA_MIN_DEG, THETA_MAX_DEG);
  } else if (anglePinned) {
    // Angle locked: vertical drag (along pipe) changes L → offset recomputes
    const delta = p.y - dragStart.y; // downward → more between bends
    L_in = clamp(dragStart.L_in + delta / dragStart.pxPerIn, 0.25, 240);
  } else {
    // Default: horizontal drag (screen-x = offset direction) changes offset height
    // Right → more offset; left → less offset.  Theta recomputes; L stays fixed.
    const delta = p.x - dragStart.x;
    offset_in = clamp(dragStart.offset_in + delta / dragStart.pxPerIn, 0.1, 240);
    L_in = dragStart.L_in;
  }

  render();
  e.preventDefault();
}

function onUp(){
  dragging = false;
  dragStart = null;
}

pipeHit.addEventListener("pointerdown", onDown);
handleEl.addEventListener("pointerdown", onDown);
svg.addEventListener("pointermove", onMove);
svg.addEventListener("pointerup", onUp);
svg.addEventListener("pointercancel", onUp);
svg.addEventListener("pointerleave", onUp);

svg.addEventListener("touchstart", ()=>{}, {passive:false});

// Initial render
render();
