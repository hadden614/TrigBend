// Conduit Visual MVP (Offset locked)
// Models a 2-bend offset: arc(R, +θ) -> straight(L) -> arc(R, -θ) -> exit straight
// User drags handle left/right to change L (Between Bends). Offset stays locked; θ is solved.

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
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

// ---- Hidden tool parameters (later becomes "Bender Select") ----
let R_in = 6.0;         // centerline radius, inches (hidden)
let PX_PER_IN = 12;     // internal display scale (hidden)

// User-facing state
let L_in = 12.0;        // Between Bends (tangent-to-tangent along the sloped segment)
let offsetLock_in = 6.0; // LOCKED offset target (inches)
let thetaDeg = 30.0;    // solved

// Straight lead-in and lead-out lengths (inches) purely for drawing context
const LEAD_IN_IN = 8;
const LEAD_OUT_IN = 8;

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
function mul(a,k){ return { x: a.x * k, y: a.y * k }; }

function fmt(n, digits=2){
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function baselineY(){
  // fixed baseline on screen
  return 330;
}

function toScreen(pMath){
  return { x: pMath.x, y: baselineY() - pMath.y };
}

function toMathFromScreen(pScreen){
  return { x: pScreen.x, y: baselineY() - pScreen.y };
}

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

function arcCmd(centerMath, startMath, endMath, sweepCCW){
  // SVG is y-down, so sweep is flipped relative to math y-up.
  const s = toScreen(startMath);
  const e = toScreen(endMath);
  const rPx = R_in * PX_PER_IN;
  const largeArc = 0;
  const sweep = sweepCCW ? 0 : 1;
  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

// ---- Core geometry + solver ----
// Height of offset for given theta (radians) using centerline model:
// H = L*sinθ + 2R*(1 - cosθ)
function offsetForTheta(thetaRad){
  return (L_in * Math.sin(thetaRad)) + 2 * R_in * (1 - Math.cos(thetaRad));
}

// Solve theta such that offsetForTheta(theta) ~= offsetLock_in.
// Monotonic in theta on (0, 90°), so binary search.
function solveThetaForOffset(targetH){
  const eps = 1e-6;
  let low = deg2rad(0.1);
  let high = deg2rad(89.0);

  // quick clamps: if target too small, return tiny angle; if too big, return near-90
  const hLow = offsetForTheta(low);
  const hHigh = offsetForTheta(high);
  if (targetH <= hLow + eps) return rad2deg(low);
  if (targetH >= hHigh - eps) return rad2deg(high);

  for (let i = 0; i < 28; i++){
    const mid = (low + high) / 2;
    const h = offsetForTheta(mid);
    if (h > targetH) high = mid;
    else low = mid;
  }
  return rad2deg((low + high) / 2);
}

function buildGeometry(){
  // Re-solve theta every render (Offset locked)
  thetaDeg = solveThetaForOffset(offsetLock_in);
  const th = deg2rad(thetaDeg);

  // Convert inches to pixels for drawing math coords
  const R = R_in * PX_PER_IN;
  const L = L_in * PX_PER_IN;
  const leadIn = LEAD_IN_IN * PX_PER_IN;
  const leadOut = LEAD_OUT_IN * PX_PER_IN;

  // First tangent point (start of first arc)
  const T1 = { x: anchor.x + leadIn, y: anchor.y };

  // Incoming direction is +x
  const dir0 = { x: 1, y: 0 };

  // Center for CCW upward bend from +x is at T1 + (0,+R)
  const C1 = add(T1, { x: 0, y: R });

  // Start radius vector from C1 to T1 is (0,-R)
  const v1s = { x: 0, y: -R };
  const v1e = rot(v1s, th);
  const E1 = add(C1, v1e);
  const dir1 = rot(dir0, th);

  // Straight between bends (tangent-to-tangent)
  const T2 = add(E1, mul(dir1, L));

  // Second bend returns to horizontal (CW by θ)
  const rightN = { x: Math.sin(th), y: -Math.cos(th) };
  const C2 = add(T2, mul(rightN, R));

  const v2s = mul(rightN, -R);
  const v2e = rot(v2s, -th);
  const E2 = add(C2, v2e);

  // Exit straight
  const END = add(E2, mul({x:1,y:0}, leadOut));
  const START = { x: anchor.x, y: anchor.y };

  // Field values
  const shrink = L_in * (1 - Math.cos(th)); // classic shrink for offset
  const trueOffset = offsetForTheta(th);

  return {
    pts: { START, T1, C1, E1, T2, C2, E2, END },
    vals: {
      thetaDeg,
      offsetLock_in,
      L_in,
      shrink,
      trueOffset
    }
  };
}

function render(){
  const { pts, vals } = buildGeometry();

  // Baseline
  setLine(baseline, {x:0, y:0}, {x:900, y:0});

  // Path: line -> arc -> line -> arc -> line
  const S = toScreen(pts.START);
  const T1s = toScreen(pts.T1);
  const T2s = toScreen(pts.T2);
  const ENDs = toScreen(pts.END);

  const d = [
    `M ${S.x} ${S.y}`,
    `L ${T1s.x} ${T1s.y}`,
    arcCmd(pts.C1, pts.T1, pts.E1, true),
    `L ${T2s.x} ${T2s.y}`,
    arcCmd(pts.C2, pts.T2, pts.E2, false),
    `L ${ENDs.x} ${ENDs.y}`,
  ].join(" ");

  pipe.setAttribute("d", d);

  // markers
  setCircle(c1El, pts.C1);
  setCircle(c2El, pts.C2);
  setCircle(t1El, pts.T1);
  setCircle(t2El, pts.T2);
  setCircle(handleEl, pts.T2); // handle at second tangent point (controls L)

  // HUD
  hudAngle.textContent = `${fmt(vals.thetaDeg,1)}°`;
  hudOffset.textContent = `${fmt(vals.offsetLock_in,2)} in`;
  hudSpacing.textContent = `${fmt(vals.L_in,2)} in`;
  hudShrink.textContent = `${fmt(vals.shrink,2)} in`;

  labelHelp.textContent = `Drag orange handle left/right to change Between Bends (Offset locked). Tap Offset/Between Bends to type.`;
}

// ---- Info drawer (QuickBend-style) ----
const explain = {
  angle: {
    title: "Angle",
    body: "Bend angle for each of the two bends in the offset.",
    body2: "Angle is solved automatically to keep your Offset locked.",
    body3: "If Between Bends increases, angle decreases (for same offset)."
  },
  offset: {
    title: "Offset (Locked)",
    body: "Your target rise (centerline) from baseline to the elevated section.",
    body2: "This includes arc geometry (real CLR), not only basic trig.",
    body3: "Tap the value to enter a new locked offset."
  },
  spacing: {
    title: "Between Bends",
    body: "Distance between tangent points along the sloped section (tangent-to-tangent).",
    body2: "In the field, this matches mark spacing depending on your bender reference.",
    body3: "Drag the handle left/right to adjust this value."
  },
  shrink: {
    title: "Shrink",
    body: "How much horizontal distance the offset consumes.",
    body2: "Used when measuring from a fixed point: you subtract shrink from your run.",
    body3: "Formula: Shrink = L(1 − cosθ)."
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

// Tap HUD -> explain, plus tap-to-enter for Offset and L
hudAngle.addEventListener("click", ()=>openInfo("angle"));
hudShrink.addEventListener("click", ()=>openInfo("shrink"));

hudOffset.addEventListener("click", ()=>{
  openInfo("offset");
  const v = prompt("Enter locked Offset (inches):", String(offsetLock_in));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  offsetLock_in = clamp(n, 0.1, 60);
  render();
});

hudSpacing.addEventListener("click", ()=>{
  openInfo("spacing");
  const v = prompt("Enter Between Bends L (inches):", String(L_in));
  if (v === null) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  L_in = clamp(n, 1, 120);
  render();
});

infoClose.addEventListener("click", closeInfo);

// ---- Dragging (direct on conduit) ----
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

function isNearHandle(p){
  const hx = parseFloat(handleEl.getAttribute("cx"));
  const hy = parseFloat(handleEl.getAttribute("cy"));
  const dx = p.x - hx, dy = p.y - hy;
  return (dx*dx + dy*dy) <= 26*26;
}

function onDown(e){
  const p = getSvgPoint(e);
  if (!isNearHandle(p)) return;

  dragging = true;
  dragStart = { x: p.x, y: p.y, L_in };
  svg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e){
  if (!dragging || !dragStart) return;

  const p = getSvgPoint(e);
  const dx = p.x - dragStart.x;

  // Convert dx (pixels) to inches. Horizontal drag changes L.
  const dL = dx / PX_PER_IN;

  L_in = clamp(dragStart.L_in + dL, 1, 120);
  render();
  e.preventDefault();
}

function onUp(){
  dragging = false;
  dragStart = null;
}

// Event wiring
handleEl.addEventListener("pointerdown", onDown);
svg.addEventListener("pointermove", onMove);
svg.addEventListener("pointerup", onUp);
svg.addEventListener("pointercancel", onUp);
svg.addEventListener("pointerleave", onUp);

// keep iOS touch-action behavior consistent
svg.addEventListener("touchstart", (e)=>{}, {passive:false});

// Initial render
render();
