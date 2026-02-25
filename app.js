// app.js (complete) — v52
// TrigBend — Offset
//
// Changes in v50:
// - Removed Flip button; orient is always "y" (vertical pipe, portrait)
// - Smaller cards (h=78), Adjacent card added
// - Handle moved to midpoint of T1→T2 diagonal
// - C1→C2 dimension line for "between bends" annotation
// - Adjacent = horizontal run of offset = 2R·sinθ + L·cosθ
// - Scale clamping: PX_PER_IN_MIN lowered so pipe never runs off screen
// - Auto-fit vertical always uses left 240px column

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
const mLineC = document.getElementById("mLineC");
const mTextC = document.getElementById("mTextC");

const hudTitle = document.getElementById("hudTitle");
const keyAngle = document.getElementById("keyAngle");
const keyOffset = document.getElementById("keyOffset");
const cardBgAngle  = document.getElementById("cardBgAngle");
const cardBgOffset = document.getElementById("cardBgOffset");
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
let R_in = 6.0; // CLR (later from bender select)

let L_in = 12.0;      // Between bends (tangent-to-tangent along sloped segment)
let offset_in = 6.0;  // Target/actual offset shown
let thetaDeg = 22.5;  // Target/actual angle shown

let lockMode = "offset"; // "offset" or "angle"

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
const DRAW_CENTER_X_Y = 115;  // horizontal center of conduit column
const DRAW_CENTER_Y   = 420;  // vertical center (fixed)
const PX_PER_IN_MIN = 2;      // low min so pipe never clips off screen
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
function fmt(n, d=2){ return Number.isFinite(n) ? n.toFixed(d) : "—"; }

// orient is always "y": rotate +90° so pipe runs top→bottom in screen
// inch-space (x right, y up) → screen-space: (x,y)→(y,−x)
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
  // clamp: never exceed PX_PER_IN_MAX, and never go below 2 (so pipe always fits)
  PX_PER_IN = clamp(Math.min(sx, sy), PX_PER_IN_MIN, PX_PER_IN_MAX);

  const cx = (minx + maxx)/2;
  const cy = (miny + maxy)/2;

  shiftPx = {
    x: DRAW_CENTER_X_Y - (cx * PX_PER_IN),
    y: 0 - (cy * PX_PER_IN)
  };
}

// ---------- Build + enforce constraints ----------
let lastStatus = "";

function enforceConstraints(){
  lastStatus = "";

  const thLocked = deg2rad(clamp(thetaDeg, THETA_MIN_DEG, THETA_MAX_DEG));

  if (lockMode === "offset"){
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

      lastStatus = "CAPPED: Bends overlap — increased Between Bends to minimum.";
    }
  } else {
    thetaDeg = rad2deg(thLocked);
    offset_in = offsetForTheta(thLocked, L_in);

    if (overlaps(thLocked, L_in)){
      const minL = findMinFeasibleL_forAngle(thLocked);
      if (minL > L_in + 1e-6) L_in = minL;
      offset_in = offsetForTheta(thLocked, L_in);

      lastStatus = "CAPPED: Bends overlap — increased Between Bends to minimum.";
    }
  }

  if (!lastStatus){
    lastStatus = "Drag pipe up/down to change spacing. Tap Angle/Offset to lock.";
  }
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

  // shrink = L(1−cosθ) + 2R(θ−sinθ)
  const shrink = L_in * (1 - Math.cos(th)) + 2 * R_in * (th - Math.sin(th));

  // adjacent = horizontal run of offset = 2R·sinθ + L·cosθ
  const adjacent = 2 * R_in * Math.sin(th) + L_in * Math.cos(th);

  return { START, T1, C1, E1, T2, C2, E2, END, shrink, adjacent };
}

// ---------- Rendering ----------
function render(){
  const g = buildGeometryInInches();

  computeAutoFitScaleAndShift(
    [g.START, g.T1, g.C1, g.E1, g.T2, g.C2, g.E2, g.END],
    R_in
  );

  // baseline (extends beyond pipe)
  setLineIn(baseline, {x:-200, y:0}, {x:200, y:0});

  const S    = toScreenFromIn(g.START);
  const T1s  = toScreenFromIn(g.T1);
  const T2s  = toScreenFromIn(g.T2);
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

  // highlight both bend arcs
  ttSegment.setAttribute("d", [
    `M ${T1s.x} ${T1s.y}`,
    arcCmdIn(g.T1, g.E1, true),
    `M ${T2s.x} ${T2s.y}`,
    arcCmdIn(g.T2, g.E2, false),
  ].join(" "));

  // tangent markers
  setCircleIn(t1El, g.T1);
  setCircleIn(t2El, g.T2);

  // drag handle at midpoint of T1→T2 diagonal
  const midT = { x: (g.T1.x + g.T2.x) / 2, y: (g.T1.y + g.T2.y) / 2 };
  setCircleIn(handleEl, midT);

  // layout start tick (perpendicular to baseline, i.e. along x-axis in inch space)
  // orient="y": "forward along pipe baseline" is inch-space +x → screen down
  // tick is perpendicular: inch-space +y → screen right
  const tickLenIn = 0.6;
  const nIn  = {x:1, y:0}; // perpendicular to baseline direction in inch-space
  const dirIn = {x:0, y:1}; // forward along baseline in inch-space (screen-down)

  setLineIn(startTick,
    add(g.T1, mul(nIn, -tickLenIn)),
    add(g.T1, mul(nIn,  tickLenIn))
  );

  // direction arrow at T1
  const arrowLenIn = 1.1;
  const wingIn = 0.35;
  const baseIn = add(g.T1, mul(dirIn, -0.2));
  const tipIn  = add(g.T1, mul(dirIn,  arrowLenIn));
  const leftWing  = add(baseIn, mul(nIn,  wingIn));
  const rightWing = add(baseIn, mul(nIn, -wingIn));
  const Lw = toScreenFromIn(leftWing);
  const Rw = toScreenFromIn(rightWing);
  const Tp = toScreenFromIn(tipIn);
  dirArrow.setAttribute("d", `M ${Tp.x} ${Tp.y} L ${Lw.x} ${Lw.y} L ${Rw.x} ${Rw.y} Z`);

  // ── Offset annotation: vertical rise from baseline to E2 level ──
  // Draw 2" to the right of g.END
  {
    const measX = g.END.x + 2;
    const a = toScreenFromIn({ x: measX, y: 0 });
    const b = toScreenFromIn({ x: measX, y: offset_in });

    mLineL.setAttribute("x1", a.x);
    mLineL.setAttribute("y1", a.y);
    mLineL.setAttribute("x2", b.x);
    mLineL.setAttribute("y2", b.y);

    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy/len, ny = vx/len;
    const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
    mTextL.setAttribute("x", mid.x + nx*14);
    mTextL.setAttribute("y", mid.y + ny*14 + 4);
    mTextL.textContent = `${fmt(offset_in,2)}"`;
  }

  // ── Between-bends annotation: C1 → C2 (arc center to arc center) ──
  {
    const c1s = toScreenFromIn(g.C1);
    const c2s = toScreenFromIn(g.C2);

    mLineC.setAttribute("x1", c1s.x);
    mLineC.setAttribute("y1", c1s.y);
    mLineC.setAttribute("x2", c2s.x);
    mLineC.setAttribute("y2", c2s.y);

    const vx = c2s.x - c1s.x, vy = c2s.y - c1s.y;
    const len = Math.hypot(vx, vy) || 1;
    // perpendicular pointing left (toward center of column)
    const nx = -vy/len, ny = vx/len;
    const mid = { x: (c1s.x + c2s.x)/2, y: (c1s.y + c2s.y)/2 };
    mTextC.setAttribute("x", mid.x + nx*16);
    mTextC.setAttribute("y", mid.y + ny*16 + 4);
    mTextC.textContent = `${fmt(L_in,2)}"`;
  }

  // ── Card highlight ──
  const LOCKED_CARD_BG   = "rgba(8,70,150,0.65)";
  const NORMAL_CARD_BG   = "rgba(14,22,38,0.90)";
  const lockedLabelClr   = "rgba(120,220,255,0.95)";
  const unlockedLabelClr = "rgba(255,255,255,0.55)";

  cardBgAngle.setAttribute("fill",  lockMode === "angle"  ? LOCKED_CARD_BG : NORMAL_CARD_BG);
  cardBgOffset.setAttribute("fill", lockMode === "offset" ? LOCKED_CARD_BG : NORMAL_CARD_BG);
  keyAngle.setAttribute("fill",  lockMode === "angle"  ? lockedLabelClr : unlockedLabelClr);
  keyOffset.setAttribute("fill", lockMode === "offset" ? lockedLabelClr : unlockedLabelClr);

  hudTitle.textContent = lockMode === "offset" ? "OFFSET LOCKED" : "ANGLE LOCKED";
  hudAngle.textContent   = `${fmt(thetaDeg,1)}°`;
  hudOffset.textContent  = `${fmt(offset_in,2)}"`;
  hudSpacing.textContent = `${fmt(L_in,2)}"`;
  hudShrink.textContent  = `${fmt(g.shrink,2)}"`;
  hudAdjacentVal.textContent = `${fmt(g.adjacent,2)}"`;

  labelHelp.textContent = lastStatus;
}

// ---------- Info drawer ----------
const explain = {
  angle: {
    title: "Angle (tap to lock)",
    body: "Locks the bend angle for both bends.",
    body2: "If Angle is locked, Offset changes as you drag Between Bends.",
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
    body2: "Drag the pipe up/down to adjust it.",
    body3: "If too small, bends overlap and Between Bends caps up."
  },
  shrink: {
    title: "Shrink",
    body: "Horizontal run lost to the offset geometry.",
    body2: "Subtract from your straight-run dimension when marking layout.",
    body3: "Formula: L(1−cosθ) + 2R(θ−sinθ)."
  },
  adjacent: {
    title: "Adjacent",
    body: "Horizontal span of the offset: how far along the run the pipe travels while making the offset.",
    body2: "Formula: 2R·sinθ + L·cosθ",
    body3: "Useful when you need the offset to fit within a fixed horizontal space."
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

// ---------- Custom input overlay (replaces prompt() — works on iOS standalone) ----------
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
    // slight delay so keyboard doesn't fight the animation
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
// tap backdrop to cancel
inputOverlay.addEventListener("click", (e) => {
  if (e.target === inputOverlay) _closeInput(null);
});

// ---------- HUD interactions ----------
hudAngle.addEventListener("click", async ()=>{
  openInfo("angle");
  const v = await showInput("Angle (°) — locks angle", thetaDeg.toFixed(1));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return;
  thetaDeg = clamp(n, THETA_MIN_DEG, THETA_MAX_DEG);
  lockMode = "angle";
  render();
});

hudOffset.addEventListener("click", async ()=>{
  openInfo("offset");
  const v = await showInput("Offset (inches) — locks offset", offset_in.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  offset_in = clamp(n, 0.1, 240);
  lockMode = "offset";
  render();
});

hudSpacing.addEventListener("click", async ()=>{
  openInfo("spacing");
  const v = await showInput("Between Bends L (inches)", L_in.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  L_in = clamp(n, 0.25, 240);
  render();
});

hudShrink.addEventListener("click", ()=>openInfo("shrink"));
hudTitle.addEventListener("click", ()=>openInfo("capped"));

document.getElementById("hudAdjacent").addEventListener("click", ()=>openInfo("adjacent"));

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
  dragStart = { x: p.x, y: p.y, L_in, pxPerIn: PX_PER_IN };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e){
  if (!dragging || !dragStart) return;
  const p = getSvgPoint(e);
  // orient="y": upward drag (smaller y) → increase L
  const delta = dragStart.y - p.y;
  const dL = delta / dragStart.pxPerIn;
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

svg.addEventListener("touchstart", ()=>{}, {passive:false});

// Initial render
render();
