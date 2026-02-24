// app.js (complete) — v20
// TrigBend — Offset (Offset locked)
//
// Interaction:
//  - Drag anywhere on the pipe (fat hitbox) left/right to change Between Bends (L).
//  - Offset stays locked; angle is solved.
//  - Tap Offset or Between Bends to type values.
//  - Tap any HUD value for a QuickBend-style explanation.
//
// Constraints (CLR-aware):
// 1) Max achievable offset for a given L and CLR occurs at θ_max. If locked offset > max, offset caps down.
// 2) Prevent bend overlap (QuickBend “second bend starts inside previous bend radius”):
//    If arcs overlap, L is increased to the minimum feasible value and the UI explains why.

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
const pipeHit = document.getElementById("pipeHit");
const baseline = document.getElementById("baseline");

const c1El = document.getElementById("c1");
const c2El = document.getElementById("c2");
const t1El = document.getElementById("t1");
const t2El = document.getElementById("t2");
const handleEl = document.getElementById("handle");
const labelHelp = document.getElementById("labelHelp");

const hudAngle = document.getElementById("hudAngle");
const hudOffset = document.getElementById("hudOffset");
const hudSpacing = document.getElementById("hudSpacing");
const hudShrink = document.getElementById("hudShrink");

const infoG = document.getElementById("info");
const infoTitle = document.getElementById("infoTitle");
const infoBody = document.getElementById("infoBody");
const infoBody2 = document.getElementById("infoBody2");
const infoBody3 = document.getElementById("infoBody3");
const infoClose = document.getElementById("infoClose");

// ---- Hidden tool parameters (later: Bender Select) ----
let R_in = 6.0;       // CLR in inches (hidden for now)
let PX_PER_IN = 12;   // internal display scale (hidden for now)

// User-facing state
let L_in = 12.0;          // Between Bends (tangent-to-tangent along sloped segment)
let offsetLock_in = 6.0;  // Locked Offset (in)
let thetaDeg = 30.0;      // Solved each render

// Drawing context (not part of field math)
const LEAD_IN_IN = 8;
const LEAD_OUT_IN = 8;

// Constraint tuning
const OVERLAP_CLEARANCE_IN = 0.25; // add small buffer beyond 2R
const THETA_MAX_DEG = 89.0;
const THETA_MIN_DEG = 0.1;

// Scene anchor in math coords (pixels). Baseline y=0.
let anchor = { x: 120, y: 0 };

// ---- Math utils ----
const deg2rad = (d) => d * Math.PI / 180;
const rad2deg = (r) => r * 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rot(v, angRad){
  const c = Math.cos(angRad), s = Math.sin(angRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
function add(a,b){ return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a,b){ return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a,k){ return { x: a.x * k, y: a.y * k }; }
function mag(v){ return Math.hypot(v.x, v.y); }
function fmt(n, digits=2){ return Number.isFinite(n) ? n.toFixed(digits) : "—"; }

function baselineY(){ return 330; }
function toScreen(pMath){ return { x: pMath.x, y: baselineY() - pMath.y }; }

function setCircle(el, pMath){
  const p = toScreen(pMath);
  el.setAttribute("cx", p.x);
  el.setAttribute("cy", p.y);
}

function setLine(el, aMath, bMath){
  const a = toScreen(aMath), b = toScreen(bMath);
  el.setAttribute("x1", a.x);
  el.setAttribute("y1", a.y);
  el.setAttribute("x2", b.x);
  el.setAttribute("y2", b.y);
}

function arcCmd(startMath, endMath, sweepCCW){
  const s = toScreen(startMath);
  const e = toScreen(endMath);
  const rPx = R_in * PX_PER_IN;
  const largeArc = 0;
  const sweep = sweepCCW ? 0 : 1; // y-down flip
  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

// ---- Core equations ----
// Offset height (centerline) for given theta and L:
// H = L*sinθ + 2R*(1 - cosθ)
function offsetForTheta(thetaRad, Ltest){
  return (Ltest * Math.sin(thetaRad)) + 2 * R_in * (1 - Math.cos(thetaRad));
}

function maxOffsetForL(Ltest){
  const th = deg2rad(THETA_MAX_DEG);
  return offsetForTheta(th, Ltest);
}

// Solve theta for a target offset at given L (binary search; monotonic on 0..89)
function solveThetaForOffset(targetH, Ltest){
  const low = deg2rad(THETA_MIN_DEG);
  const high = deg2rad(THETA_MAX_DEG);

  const hLow = offsetForTheta(low, Ltest);
  const hHigh = offsetForTheta(high, Ltest);

  if (targetH <= hLow) return { thetaDeg: THETA_MIN_DEG, capped: true, reason: "Offset capped to minimum." };
  if (targetH >= hHigh) return { thetaDeg: THETA_MAX_DEG, capped: true, reason: "Offset capped: not achievable for this L + CLR." };

  let a = low, b = high;
  for (let i = 0; i < 28; i++){
    const mid = (a + b) / 2;
    const h = offsetForTheta(mid, Ltest);
    if (h > targetH) b = mid;
    else a = mid;
  }
  return { thetaDeg: rad2deg((a + b) / 2), capped: false, reason: "" };
}

// Centers in INCH-space for overlap test (lead-in/out irrelevant)
function centersInInches(thetaRad, Ltest){
  // Place T1 at (0,0)
  const T1 = { x: 0, y: 0 };
  const dir0 = { x: 1, y: 0 };

  // First arc center
  const C1 = { x: 0, y: R_in };

  // End of first arc
  const v1s = { x: 0, y: -R_in };
  const v1e = rot(v1s, thetaRad);
  const E1 = add(C1, v1e);

  // Direction after first bend
  const dir1 = rot(dir0, thetaRad);

  // Second tangent
  const T2 = add(E1, mul(dir1, Ltest));

  // Second arc center (return to horizontal)
  const rightN = { x: Math.sin(thetaRad), y: -Math.cos(thetaRad) };
  const C2 = add(T2, mul(rightN, R_in));

  return { C1, C2 };
}

function overlaps(thetaRad, Ltest){
  const { C1, C2 } = centersInInches(thetaRad, Ltest);
  const d = mag(sub(C2, C1));
  const minDist = (2 * R_in) + OVERLAP_CLEARANCE_IN;
  return d < minDist;
}

// Find minimum feasible L (no overlap) for current locked offset.
// Uses binary search on L; theta is solved at each L.
function findMinFeasibleL(targetOffset){
  let Llo = 0.25;
  let Lhi = Math.max(L_in, 1);

  // Expand hi until feasible
  for (let i = 0; i < 24; i++){
    const maxH = maxOffsetForL(Lhi);
    const usedOffset = Math.min(targetOffset, maxH);
    const sol = solveThetaForOffset(usedOffset, Lhi);
    const th = deg2rad(sol.thetaDeg);

    if (!overlaps(th, Lhi)) break;
    Lhi *= 1.4;
    if (Lhi > 240) break;
  }

  // Binary search for first feasible
  for (let i = 0; i < 28; i++){
    const mid = (Llo + Lhi) / 2;
    const maxH = maxOffsetForL(mid);
    const usedOffset = Math.min(targetOffset, maxH);
    const sol = solveThetaForOffset(usedOffset, mid);
    const th = deg2rad(sol.thetaDeg);

    if (!overlaps(th, mid)) Lhi = mid;
    else Llo = mid;
  }

  return Lhi;
}

// Constraint enforcement returns a status message and a "capped" flag
let lastCapReason = "";

function enforceConstraints(){
  lastCapReason = "";

  // A) Cap offset down if impossible at current L
  const maxH = maxOffsetForL(L_in);
  if (offsetLock_in > maxH){
    offsetLock_in = maxH;
    lastCapReason = "Offset capped: not achievable for this Between Bends + CLR.";
  }

  // B) Solve theta
  const sol = solveThetaForOffset(offsetLock_in, L_in);
  thetaDeg = sol.thetaDeg;

  if (sol.capped && !lastCapReason){
    lastCapReason = sol.reason || "Value capped by limits.";
  }

  // C) Prevent overlap (QuickBend-style)
  const th = deg2rad(thetaDeg);
  if (overlaps(th, L_in)){
    const minL = findMinFeasibleL(offsetLock_in);
    if (minL > L_in + 1e-6){
      L_in = minL;

      // Re-cap offset if needed after L change (normally increases max offset, but keep safe)
      const maxH2 = maxOffsetForL(L_in);
      if (offsetLock_in > maxH2) offsetLock_in = maxH2;

      thetaDeg = solveThetaForOffset(offsetLock_in, L_in).thetaDeg;
    }
    lastCapReason = "Between Bends capped: bends overlap (second bend starts inside first bend radius).";
  }

  if (!lastCapReason){
    return "Drag pipe left/right to change Between Bends. Tap HUD values to edit / learn.";
  }
  return `CAPPED: ${lastCapReason} (tap any value for why)`;
}

function buildGeometry(){
  const status = enforceConstraints();
  const th = deg2rad(thetaDeg);

  // inch -> pixel for drawing
  const R = R_in * PX_PER_IN;
  const L = L_in * PX_PER_IN;
  const leadIn = LEAD_IN_IN * PX_PER_IN;
  const leadOut = LEAD_OUT_IN * PX_PER_IN;

  const T1 = { x: anchor.x + leadIn, y: anchor.y };
  const dir0 = { x: 1, y: 0 };

  const C1 = add(T1, { x: 0, y: R });

  const v1s = { x: 0, y: -R };
  const v1e = rot(v1s, th);
  const E1 = add(C1, v1e);
  const dir1 = rot(dir0, th);

  const T2 = add(E1, mul(dir1, L));

  const rightN = { x: Math.sin(th), y: -Math.cos(th) };
  const C2 = add(T2, mul(rightN, R));

  const v2s = mul(rightN, -R);
  const v2e = rot(v2s, -th);
  const E2 = add(C2, v2e);

  const END = add(E2, mul({x:1,y:0}, leadOut));
  const START = { x: anchor.x, y: anchor.y };

  const shrink = L_in * (1 - Math.cos(th));

  return {
    status,
    pts: { START, T1, C1, E1, T2, C2, E2, END },
    vals: { thetaDeg, offsetLock_in, L_in, shrink }
  };
}

function render(){
  const { status, pts, vals } = buildGeometry();

  setLine(baseline, {x:0, y:0}, {x:900, y:0});

  const S = toScreen(pts.START);
  const T1s = toScreen(pts.T1);
  const T2s = toScreen(pts.T2);
  const ENDs = toScreen(pts.END);

  const d = [
    `M ${S.x} ${S.y}`,
    `L ${T1s.x} ${T1s.y}`,
    arcCmd(pts.T1, pts.E1, true),
    `L ${T2s.x} ${T2s.y}`,
    arcCmd(pts.T2, pts.E2, false),
    `L ${ENDs.x} ${ENDs.y}`,
  ].join(" ");

  pipe.setAttribute("d", d);
  pipeHit.setAttribute("d", d);

  setCircle(c1El, pts.C1);
  setCircle(c2El, pts.C2);
  setCircle(t1El, pts.T1);
  setCircle(t2El, pts.T2);

  // handle shown at T2 (same as prior versions)
  setCircle(handleEl, pts.T2);

  hudAngle.textContent = `${fmt(vals.thetaDeg,1)}°`;
  hudOffset.textContent = `${fmt(vals.offsetLock_in,2)} in`;
  hudSpacing.textContent = `${fmt(vals.L_in,2)} in`;
  hudShrink.textContent = `${fmt(vals.shrink,2)} in`;

  labelHelp.textContent = status;
}

// ---- Info drawer ----
const explain = {
  angle: {
    title: "Angle",
    body: "Bend angle for each of the two bends.",
    body2: "Angle is solved automatically because Offset is locked.",
    body3: "If L gets smaller, angle must increase to hit the same offset."
  },
  offset: {
    title: "Offset (Locked)",
    body: "Your target rise of the centerline above baseline.",
    body2: "Includes CLR arc geometry (not only basic trig).",
    body3: "If impossible for current L+CLR, it caps down to the max."
  },
  spacing: {
    title: "Between Bends",
    body: "Tangent-to-tangent spacing along the sloped segment.",
    body2: "Drag the pipe left/right to adjust it.",
    body3: "If too small, bends overlap and L caps up automatically."
  },
  shrink: {
    title: "Shrink",
    body: "How much horizontal distance the offset consumes.",
    body2: "Used when measuring from a fixed point: subtract shrink from your run.",
    body3: "Formula: Shrink = L(1 − cosθ)."
  },
  capped: {
    title: "Why it capped",
    body: "Two reasons:",
    body2: "1) Offset too high for this L + CLR (would require >89°), or",
    body3: "2) Bends overlap: second bend starts inside the first bend radius."
  }
};

function openInfo(key){
  const e = explain[key];
  infoTitle.textContent = e.title;
  infoBody.textContent = e.body;
  infoBody2.textContent = e.body2;
  infoBody3.textContent = e.body3;
  infoG.setAttribute("visibility","visible");
}
function closeInfo(){
  infoG.setAttribute("visibility","hidden");
}

hudAngle.addEventListener("click", ()=>openInfo("angle"));
hudShrink.addEventListener("click", ()=>openInfo("shrink"));

hudOffset.addEventListener("click", ()=>{
  openInfo("offset");
  const v = prompt("Enter locked Offset (inches):", String(offsetLock_in.toFixed(2)));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  offsetLock_in = clamp(n, 0.1, 120);
  render();
});

hudSpacing.addEventListener("click", ()=>{
  openInfo("spacing");
  const v = prompt("Enter Between Bends L (inches):", String(L_in.toFixed(2)));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  L_in = clamp(n, 0.25, 240);
  render();
});

hudAngle.addEventListener("dblclick", ()=>openInfo("capped"));
hudOffset.addEventListener("dblclick", ()=>openInfo("capped"));
hudSpacing.addEventListener("dblclick", ()=>openInfo("capped"));
hudShrink.addEventListener("dblclick", ()=>openInfo("capped"));

infoClose.addEventListener("click", closeInfo);

// ---- Dragging (pipe hitbox) ----
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
  const p = getSvgPoint(e);
  dragging = true;
  dragStart = { x: p.x, y: p.y, L_in };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e){
  if (!dragging || !dragStart) return;

  const p = getSvgPoint(e);
  const dx = p.x - dragStart.x;

  // Horizontal drag changes L
  const dL = dx / PX_PER_IN;
  L_in = clamp(dragStart.L_in + dL, 0.25, 240);

  render();
  e.preventDefault();
}

function onUp(){
  dragging = false;
  dragStart = null;
}

// Start drag from fat hitbox OR handle
pipeHit.addEventListener("pointerdown", onDown);
handleEl.addEventListener("pointerdown", onDown);

svg.addEventListener("pointermove", onMove);
svg.addEventListener("pointerup", onUp);
svg.addEventListener("pointercancel", onUp);
svg.addEventListener("pointerleave", onUp);

// iOS touch-action support
svg.addEventListener("touchstart", (e)=>{}, {passive:false});

// Initial render
render();
