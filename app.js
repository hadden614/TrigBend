// app.js (complete) — v40
// TrigBend — Offset
//
// Visible changes included:
// 1) Tangent-to-tangent straight segment highlighted brown.
// 2) Layout start mark at first tangent (tick + direction arrow).
// 3) Auto-fit: uses screen space (no long wasted stretch).
// 4) Flip orientation (horizontal/vertical baseline). Angle and Offset are both editable + lockable.
//
// Interaction:
// - Drag pipe left/right: changes Between Bends (L).
// - Tap Angle: enter angle and LOCK ANGLE.
// - Tap Offset: enter offset and LOCK OFFSET.
// - Tap Between Bends: enter L.
// - Tap Flip: rotate (QuickBend-like vertical option).
//
// Constraints:
// - If Offset locked and impossible for L+CLR, Offset caps down.
// - Prevent bend overlap (QuickBend “bend into previous bend radius”): if overlap, L caps up.

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
const ttSegment = document.getElementById("ttSegment");
const pipeHit = document.getElementById("pipeHit");
const baseline = document.getElementById("baseline");

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

// ---------- Geometry / UI state ----------
let R_in = 6.0; // CLR (later from bender select)

let L_in = 12.0;      // Between bends (tangent-to-tangent along sloped segment)
let offset_in = 6.0;  // Target/actual offset shown
let thetaDeg = 22.5;  // Target/actual angle shown

let lockMode = "offset"; // "offset" or "angle"
let orient = "x";        // "x" baseline horizontal, "y" baseline vertical

// drawing-only (inches)
const LEAD_IN_IN = 4;
const LEAD_OUT_IN = 4;

// limits / constraints
const THETA_MIN_DEG = 0.1;
const THETA_MAX_DEG = 89.0;
const OVERLAP_CLEARANCE_IN = 0.25;

// auto-fit scale
const VIEW_W = 900;
const VIEW_H = 520;
const MARGIN = 52;
const PX_PER_IN_MIN = 7;
const PX_PER_IN_MAX = 22;
let PX_PER_IN = 12;

// centering in *pixels* after scaling and orientation
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
function fmt(n, d=2){ return Number.isFinite(n) ? n.toFixed(d) : "—"; }

function orientXformIn(pIn){
  // operate in INCH space
  if (orient === "x") return pIn;
  // rotate +90°: (x,y)->(y,-x)
  return { x: pIn.y, y: -pIn.x };
}

// screen mapping uses px values after scale + orientation
function toScreenFromIn(pIn){
  const p = orientXformIn(pIn);
  const xpx = p.x * PX_PER_IN + shiftPx.x;
  const ypx = p.y * PX_PER_IN + shiftPx.y;
  // y-down svg
  return { x: xpx, y: (VIEW_H/2) - ypx };
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

// overlap test in INCH space
function centersInInches(thetaRad, Ltest){
  // put T1 at (0,0)
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
  const minDist = (2*R_in) + OVERLAP_CLEARANCE_IN;
  return d < minDist;
}

function findMinFeasibleL_forOffset(targetOffset){
  // for offset-locked: theta changes with L
  let Llo = 0.25;
  let Lhi = Math.max(L_in, 1);

  // expand hi until not overlapping (or hit a ceiling)
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
  // for angle-locked: theta fixed, only need L to stop overlap
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
  // allPtsIn are inch-space points BEFORE orientation; we apply orientation in bbox calc.
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

  const sx = (VIEW_W - 2*MARGIN) / wIn;
  const sy = (VIEW_H - 2*MARGIN) / hIn;
  PX_PER_IN = clamp(Math.min(sx, sy), PX_PER_IN_MIN, PX_PER_IN_MAX);

  // shift so bbox center sits at screen center (in px, then converted in toScreenFromIn)
  const cx = (minx + maxx)/2;
  const cy = (miny + maxy)/2;

  shiftPx = {
    x: (VIEW_W/2) - (cx * PX_PER_IN),
    y: 0 - (cy * PX_PER_IN) // because we already center around VIEW_H/2 in y mapping
  };
}

// ---------- Build + enforce constraints ----------
let lastStatus = "";

function enforceConstraints(){
  lastStatus = "";

  const thLocked = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));

  if (lockMode === "offset"){
    // cap offset if impossible
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

      // recompute after L cap
      const maxH2 = maxOffsetForL(L_in);
      if (offset_in > maxH2) offset_in = maxH2;
      thetaDeg = solveThetaForOffset(offset_in, L_in).thetaDeg;

      lastStatus = "CAPPED: Bends overlap (second bend would start inside first bend radius).";
    }
  } else {
    // angle locked: offset becomes derived from angle, but still avoid overlap
    thetaDeg = rad2deg(thLocked);
    offset_in = offsetForTheta(thLocked, L_in);

    if (overlaps(thLocked, L_in)){
      const minL = findMinFeasibleL_forAngle(thLocked);
      if (minL > L_in + 1e-6) L_in = minL;
      offset_in = offsetForTheta(thLocked, L_in);

      lastStatus = "CAPPED: Bends overlap (increased Between Bends to minimum).";
    }
  }

  if (!lastStatus){
    lastStatus = "Drag pipe left/right. Tap Angle/Offset to lock. Tap Flip to rotate.";
  }
}

function buildGeometryInInches(){
  enforceConstraints();

  const th = deg2rad(thetaDeg);

  // define points in inches with T1 at (0,0)
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
  const END = add(E2, { x: LEAD_OUT_IN, y: 0 });

  // Full shrink: horizontal run reduction = straight-section loss + arc-section loss
  // shrink = L*(1-cosθ) + 2R*(θ - sinθ)
  const shrink = L_in * (1 - Math.cos(th)) + 2 * R_in * (th - Math.sin(th));

  return { START, T1, C1, E1, T2, C2, E2, END, shrink };
}

// ---------- Rendering ----------
function render(){
  const g = buildGeometryInInches();

  // auto-fit using key points + radius margin
  computeAutoFitScaleAndShift(
    [g.START, g.T1, g.C1, g.E1, g.T2, g.C2, g.E2, g.END],
    R_in
  );

  // baseline through y=0, long line
  setLineIn(baseline, {x:-200, y:0}, {x:200, y:0});

  // full pipe path
  const S = toScreenFromIn(g.START);
  const T1s = toScreenFromIn(g.T1);
  const T2s = toScreenFromIn(g.T2);
  const ENDs = toScreenFromIn(g.END);

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

  // highlight tangent-to-tangent straight segment (E1 -> T2)
  const E1s = toScreenFromIn(g.E1);
  ttSegment.setAttribute("d", `M ${E1s.x} ${E1s.y} L ${T2s.x} ${T2s.y}`);

  // markers
  setCircleIn(t1El, g.T1);
  setCircleIn(t2El, g.T2);
  setCircleIn(handleEl, g.T2);

  // layout start tick + direction arrow at T1 in direction of incoming baseline (+x in inch space)
  // Tick is perpendicular to baseline direction
  const tickLenIn = 0.6;
  const dirIn = (orient === "x") ? {x:1,y:0} : {x:0,y:1}; // after flip, “forward along baseline” is screen-up/down; we show consistent arrow
  const nIn = (orient === "x") ? {x:0,y:1} : {x:1,y:0};

  const tickA = add(g.T1, mul(nIn, -tickLenIn));
  const tickB = add(g.T1, mul(nIn,  tickLenIn));
  setLineIn(startTick, tickA, tickB);

  // direction arrow as small triangle
  const arrowLenIn = 1.1;
  const baseIn = add(g.T1, mul(dirIn, -0.2));
  const tipIn  = add(g.T1, mul(dirIn,  arrowLenIn));
  const wingIn = 0.35;

  const leftWing = add(baseIn, mul(nIn,  wingIn));
  const rightWing = add(baseIn, mul(nIn, -wingIn));

  const L = toScreenFromIn(leftWing);
  const R = toScreenFromIn(rightWing);
  const T = toScreenFromIn(tipIn);
  dirArrow.setAttribute("d", `M ${T.x} ${T.y} L ${L.x} ${L.y} L ${R.x} ${R.y} Z`);

  // measurement line for L: draw parallel to E1->T2, offset slightly
  {
    const a = toScreenFromIn(g.E1);
    const b = toScreenFromIn(g.T2);
    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy/len, ny = vx/len;

    // offset outward
    const off = 22;
    const a2 = { x: a.x + nx*off, y: a.y + ny*off };
    const b2 = { x: b.x + nx*off, y: b.y + ny*off };

    mLineL.setAttribute("x1", a2.x);
    mLineL.setAttribute("y1", a2.y);
    mLineL.setAttribute("x2", b2.x);
    mLineL.setAttribute("y2", b2.y);

    const mid = { x: (a2.x + b2.x)/2, y: (a2.y + b2.y)/2 };
    mTextL.setAttribute("x", mid.x + nx*10);
    mTextL.setAttribute("y", mid.y + ny*10);
    mTextL.textContent = `${fmt(L_in,2)} in`;
  }

  // HUD values
  hudTitle.textContent = lockMode === "offset" ? "LOCKED: OFFSET" : "LOCKED: ANGLE";
  hudAngle.textContent = `${fmt(thetaDeg,1)}°`;
  hudOffset.textContent = `${fmt(offset_in,2)} in`;
  hudSpacing.textContent = `${fmt(L_in,2)} in`;
  hudShrink.textContent = `${fmt(g.shrink,2)} in`;

  labelHelp.textContent = lastStatus;
}

// ---------- Info drawer ----------
const explain = {
  angle: {
    title: "Angle (tap to lock)",
    body: "Locks the bend angle for both bends.",
    body2: "If Angle is locked, Offset will change as you drag Between Bends.",
    body3: "Angle is capped to < 90°."
  },
  offset: {
    title: "Offset (tap to lock)",
    body: "Locks the vertical rise (centerline) of the offset.",
    body2: "If Offset is locked, Angle is solved automatically for your Between Bends.",
    body3: "If impossible (or overlap), values cap to realistic limits."
  },
  spacing: {
    title: "Between Bends",
    body: "Tangent-to-tangent spacing along the sloped section.",
    body2: "Drag the pipe left/right to adjust it.",
    body3: "If too small, bends overlap and Between Bends caps up."
  },
  shrink: {
    title: "Shrink",
    body: "How much horizontal distance the offset consumes.",
    body2: "Used when measuring from a fixed point: subtract shrink from your run.",
    body3: "Formula: Shrink = L(1 − cosθ)."
  },
  flip: {
    title: "Flip",
    body: "Rotates the layout so the baseline is horizontal or vertical.",
    body2: "Useful for a QuickBend-style vertical presentation.",
    body3: "This is display-only; math stays the same."
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
  infoBody.textContent = e.body;
  infoBody2.textContent = e.body2;
  infoBody3.textContent = e.body3;
  infoG.setAttribute("visibility","visible");
}
function closeInfo(){
  infoG.setAttribute("visibility","hidden");
}
infoClose.addEventListener("click", closeInfo);

// ---------- HUD interactions ----------
hudFlip.addEventListener("click", ()=>{
  orient = (orient === "x") ? "y" : "x";
  openInfo("flip");
  render();
});

hudAngle.addEventListener("click", ()=>{
  openInfo("angle");
  const v = prompt("Enter Angle (degrees). This will LOCK ANGLE:", String(thetaDeg.toFixed(1)));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return;
  thetaDeg = clamp(n, THETA_MIN_DEG, THETA_MAX_DEG);
  lockMode = "angle";
  render();
});

hudOffset.addEventListener("click", ()=>{
  openInfo("offset");
  const v = prompt("Enter Offset (inches). This will LOCK OFFSET:", String(offset_in.toFixed(2)));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  offset_in = clamp(n, 0.1, 240);
  lockMode = "offset";
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

hudShrink.addEventListener("click", ()=>openInfo("shrink"));
hudTitle.addEventListener("click", ()=>openInfo("capped"));

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
  const p = getSvgPoint(e);
  dragging = true;
  // snapshot PX_PER_IN so drag sensitivity stays consistent even as auto-fit rescales
  dragStart = { x: p.x, y: p.y, L_in, pxPerIn: PX_PER_IN };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e){
  if (!dragging || !dragStart) return;
  const p = getSvgPoint(e);

  // horizontal drag changes L (works well in both orientations on phone)
  const dx = p.x - dragStart.x;
  const dL = dx / dragStart.pxPerIn; // use scale captured at drag start

  L_in = clamp(dragStart.L_in + dL, 0.25, 240);
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

// iOS touch-action support
svg.addEventListener("touchstart", (e)=>{}, {passive:false});

// Initial render
render();
