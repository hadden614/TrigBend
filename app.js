// TrigBend — Offset (Offset locked)
// Interaction: drag pipe (fat hitbox) left/right to change L (Between Bends).
// Solver: θ is solved to keep Offset locked.
// Constraints:
//  1) Offset must be achievable for this L and CLR (R). If not, Offset caps to max and explains.
//  2) Bends must not overlap (QuickBend-style “bend into previous bend”). If overlap, L caps to minimum and explains.

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

// ---- Hidden tool parameters (later becomes “Bender Select”) ----
let R_in = 6.0;       // CLR in inches (hidden)
let PX_PER_IN = 12;   // internal display scale (hidden)

// User-facing state
let L_in = 12.0;          // Between Bends (tangent-to-tangent along sloped segment)
let offsetLock_in = 6.0;  // LOCKED offset target (inches)
let thetaDeg = 30.0;      // solved each render

// Lead-in/out for drawing context only
const LEAD_IN_IN = 8;
const LEAD_OUT_IN = 8;

// Overlap rule tuning
const OVERLAP_CLEARANCE_IN = 0.25; // extra separation beyond 2R (tweak later)
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

function fmt(n, digits=2){
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function baselineY(){ return 330; }

function toScreen(pMath){
  return { x: pMath.x, y: baselineY() - pMath.y };
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

function arcCmd(startMath, endMath, sweepCCW){
  const s = toScreen(startMath);
  const e = toScreen(endMath);
  const rPx = R_in * PX_PER_IN;
  const largeArc = 0;
  const sweep = sweepCCW ? 0 : 1; // y-down flip
  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

// ---- Core equations ----
// Centerline offset height for given theta:
// H = L*sinθ + 2R*(1 - cosθ)
function offsetForTheta(thetaRad, Ltest){
  return (Ltest * Math.sin(thetaRad)) + 2 * R_in * (1 - Math.cos(thetaRad));
}

function maxOffsetForL(Ltest){
  const th = deg2rad(THETA_MAX_DEG);
  return offsetForTheta(th, Ltest);
}

function solveThetaForOffset(targetH, Ltest){
  const low = deg2rad(THETA_MIN_DEG);
  const high = deg2rad(THETA_MAX_DEG);

  const hLow = offsetForTheta(low, Ltest);
  const hHigh = offsetForTheta(high, Ltest);

  if (targetH <= hLow) return { thetaDeg: THETA_MIN_DEG, capped: true, reason: "Offset capped to minimum." };
  if (targetH >= hHigh) return { thetaDeg: THETA_MAX_DEG, capped: true, reason: "Offset capped: not achievable for this Between Bends + CLR." };

  let a = low, b = high;
  for (let i = 0; i < 28; i++){
    const mid = (a + b) / 2;
    const h = offsetForTheta(mid, Ltest);
    if (h > targetH) b = mid;
    else a = mid;
  }
  return { thetaDeg: rad2deg((a + b) / 2), capped: false, reason: "" };
}

// Build centers in INCH-space for overlap test (lead-in/out irrelevant)
function centersInInches(thetaRad, Ltest){
  // Put T1 at origin (0,0) in inches
  const T1 = { x: 0, y: 0 };

  // Incoming dir +x
  const dir0 = { x: 1, y: 0 };

  // Center of first CCW arc: C1 = T1 + (0, R)
  const C1 = { x: 0, y: R_in };

  // End of first arc E1
  const v1s = { x: 0, y: -R_in };
  const v1e = rot(v1s, thetaRad);
  const E1 = add(C1, v1e);

  // Direction after first arc
  const dir1 = rot(dir0, thetaRad);

  // Second tangent point T2 = E1 + dir1 * L
  const T2 = add(E1, mul(dir1, Ltest));

  // Center of second arc returning to horizontal:
  // right normal of dir1 = (sinθ, -cosθ)
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

// Find minimum L that avoids overlap while keeping Offset locked (theta solved per L).
function findMinFeasibleL(targetOffset){
  // Start at current L and increase until it stops overlapping and offset is achievable
  let Llo = 0.25;
  let Lhi = Math.max(L_in, 1);

  // Ensure hi is feasible; grow if needed
  for (let i = 0; i < 20; i++){
    // First cap targetOffset if impossible at this Lhi
    const maxH = maxOffsetForL(Lhi);
    const usedOffset = Math.min(targetOffset, maxH);

    const s = solveThetaForOffset(usedOffset, Lhi);
    const th = deg2rad(s.thetaDeg);

    if (!overlaps(th, Lhi) && usedOffset <= maxH + 1e-6) {
      break;
    }
    Lhi *= 1.4;
    if (Lhi > 240) break;
  }

  // Binary search from Llo..Lhi for first feasible
  for (let i = 0; i < 28; i++){
    const mid = (Llo + Lhi) / 2;

    const maxH = maxOffsetForL(mid);
    const usedOffset = Math.min(targetOffset, maxH);

    const s = solveThetaForOffset(usedOffset, mid);
    const th = deg2rad(s.thetaDeg);

    const ok = (!overlaps(th, mid));
    if (ok) Lhi = mid;
    else Llo = mid;
  }
  return Lhi;
}

// Enforce constraints and return render-ready theta/notes
function enforceConstraints(){
  let note = "";

  // 1) If locked offset is impossible for this L, cap it down to max for this L
  const maxH = maxOffsetForL(L_in);
  if (offsetLock_in > maxH){
    offsetLock_in = maxH;
    note = "CAPPED: Offset too high for this Between Bends + CLR (bender radius).";
  }

  // 2) Solve theta for (offsetLock, L)
  const sol = solveThetaForOffset(offsetLock_in, L_in);
  thetaDeg = sol.thetaDeg;

  if (sol.capped && !note){
    note = "CAPPED: Offset limited by current Between Bends + CLR.";
  }

  // 3) Overlap check (QuickBend-style)
  const th = deg2rad(thetaDeg);
  if (overlaps(th, L_in)){
    const newL = findMinFeasibleL(offsetLock_in);
    if (newL > L_in + 1e-6){
      L_in = newL;
      // recompute with updated L
      const maxH2 = maxOffsetForL(L_in);
      if (offsetLock_in > maxH2) offsetLock_in = maxH2;
      thetaDeg = solveThetaForOffset(offsetLock_in, L_in).thetaDeg;
    }
    note = "CAPPED: Bends overlap (second bend starts inside first bend radius).";
  }

  if (!note){
    note = "Drag pipe left/right to change Between Bends. Tap values to edit / learn.";
  }
  return note;
}

function buildGeometry(){
  const status = enforceConstraints();
  const th = deg2rad(thetaDeg);

  // inch -> pixel scale for drawing
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

  // baseline
  setLine(baseline, {x:0, y:0}, {x:900, y:0});

  // build path commands
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

  // markers
  setCircle(c1El, pts.C1);
  setCircle(c2El, pts.C2);
  setCircle(t1El, pts.T1);
  setCircle(t2El, pts.T2);
  setCircle(handleEl, pts.T2);

  // HUD
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
    body3: "Changing Between Bends changes the required Angle."
  },
  offset: {
    title: "Offset (Locked)",
    body: "Your target rise of the centerline above baseline.",
    body2: "This includes true CLR geometry (not only basic trig).",
    body3: "If Offset is impossible for the current L+CLR, it will cap."
  },
  spacing: {
    title: "Between Bends",
    body: "Tangent-to-tangent spacing along the sloped segment.",
    body2: "This is what you’re adjusting by dragging the pipe.",
    body3: "If too small, bends overlap and the app caps it."
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
    body2: "1) Offset too high for this Between Bends + CLR (needs >89°), OR",
    body3: "2) Bends overlap (second bend starts inside first bend radius)."
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

// ---- Dragging (pipe hitbox + handle) ----
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

// Start drag from handle OR anywhere on pipeHit
handleEl.addEventListener("pointerdown", onDown);
pipeHit.addEventListener("pointerdown", onDown);

svg.addEventListener("pointermove", onMove);
svg.addEventListener("pointerup", onUp);
svg.addEventListener("pointercancel", onUp);
svg.addEventListener("pointerleave", onUp);

// iOS touch-action support
svg.addEventListener("touchstart", (e)=>{}, {passive:false});

// Initial render
render();
