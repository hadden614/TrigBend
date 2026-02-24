// Conduit Visual MVP
// Models a 2-bend offset: arc(R, +θ) -> straight(L) -> arc(R, -θ) -> exit straight
// Uses math coordinates (x right, y up). Converts to SVG screen coords (y down).

const svg = document.getElementById("svg");
const pipe = document.getElementById("pipe");
const baseline = document.getElementById("baseline");
const c1El = document.getElementById("c1");
const c2El = document.getElementById("c2");
const t1El = document.getElementById("t1");
const t2El = document.getElementById("t2");
const handleEl = document.getElementById("handle");
const labelTheta = document.getElementById("labelTheta");
const labelHelp = document.getElementById("labelHelp");
const metricsEl = document.getElementById("metrics");

const rInput = document.getElementById("rInput");
const lInput = document.getElementById("lInput");
const scaleInput = document.getElementById("scaleInput");
const rVal = document.getElementById("rVal");
const lVal = document.getElementById("lVal");
const scaleVal = document.getElementById("scaleVal");

const W = 900, H = 520;

// Scene anchor in math coords
// We'll place the first tangent point T1 around here:
let anchor = { x: 120, y: 0 }; // math coords, y=0 is baseline

// State
let R_in = parseFloat(rInput.value);
let L_in = parseFloat(lInput.value);
let PX_PER_IN = parseFloat(scaleInput.value);

// θ in degrees (0..90)
let thetaDeg = 30;

// Straight lead-in and lead-out lengths (inches)
const LEAD_IN_IN = 8;
const LEAD_OUT_IN = 8;

// Utils
const deg2rad = (d) => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rot(v, angRad){
  const c = Math.cos(angRad), s = Math.sin(angRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function add(a,b){ return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a,b){ return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a,k){ return { x: a.x * k, y: a.y * k }; }

function toScreen(pMath){
  // Baseline y=0 in math coords maps to screen y around mid-height
  const baselineY = 330;
  return {
    x: pMath.x,
    y: baselineY - pMath.y
  };
}

function fmt(n, digits=2){
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
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

function arcPath(centerMath, startMath, endMath, sweepCCW){
  // SVG arc uses screen coords (y down), which flips sweep.
  // We build an 'A' command using radius in screen units.
  const c = toScreen(centerMath);
  const s = toScreen(startMath);
  const e = toScreen(endMath);

  // Radius in pixels (screen == math x scale)
  const rPx = R_in * PX_PER_IN;

  // Determine flags:
  // large-arc is always 0 here since θ <= 90°
  const largeArc = 0;

  // sweep flag: with y-down coords, CCW in math becomes CW in screen.
  // If sweepCCW (math) is true, SVG sweep should be 0 (counter)?? Actually inverted:
  // Empirically: flip it.
  const sweep = sweepCCW ? 0 : 1;

  return `A ${rPx} ${rPx} 0 ${largeArc} ${sweep} ${e.x} ${e.y}`;
}

function buildGeometry(){
  // Convert inches to pixels via scaling in math x/y.
  // We'll keep math coords already in pixels; treat "inches" as scaled by PX_PER_IN.

  const R = R_in * PX_PER_IN; // radius in math "pixels"
  const L = L_in * PX_PER_IN;
  const leadIn = LEAD_IN_IN * PX_PER_IN;
  const leadOut = LEAD_OUT_IN * PX_PER_IN;

  const th = deg2rad(thetaDeg);

  // First tangent point (start of first arc)
  const T1 = { x: anchor.x + leadIn, y: anchor.y };

  // Incoming direction is +x
  const dir0 = { x: 1, y: 0 };

  // Center for a CCW (upward) bend from +x is at T1 + leftNormal*R
  // left normal of +x is (0, +1)
  const C1 = add(T1, { x: 0, y: R });

  // Start radius vector from center to T1 is (0, -R)
  const v1s = { x: 0, y: -R };
  const v1e = rot(v1s, th);           // rotate CCW by θ
  const E1 = add(C1, v1e);            // end of first arc
  const dir1 = rot(dir0, th);         // outgoing direction after first arc

  // Straight between bends (tangent-to-tangent)
  const T2 = add(E1, mul(dir1, L));

  // Second bend returns to horizontal (CW by θ)
  // Right normal of dir1 = (sinθ, -cosθ)
  const rightN = { x: Math.sin(th), y: -Math.cos(th) };
  const C2 = add(T2, mul(rightN, R));

  // Start radius vector from C2 to T2 is -rightN*R
  const v2s = mul(rightN, -R);
  const v2e = rot(v2s, -th);          // rotate CW by θ
  const E2 = add(C2, v2e);

  // Exit straight (horizontal)
  const dir2 = { x: 1, y: 0 };
  const END = add(E2, mul(dir2, leadOut));

  // Lead-in start point
  const START = { x: anchor.x, y: anchor.y };

  // Metrics (in inches, using real trig + true arc contribution)
  const rise_tangent_only = (L_in) * Math.sin(th);         // between tangent points only
  const run_tangent_only  = (L_in) * Math.cos(th);

  const arc_rise_each = (R_in) * (1 - Math.cos(th));       // each arc adds vertical gain
  const arc_run_each  = (R_in) * Math.sin(th);             // each arc adds horizontal advance

  const true_offset = rise_tangent_only + 2 * arc_rise_each;
  const true_advance = run_tangent_only + 2 * arc_run_each;

  const arc_len_each = (Math.PI * R_in) * (thetaDeg / 180);  // (θ/360)*2πR = πR*(θ/180)
  const developed_len = (LEAD_IN_IN + LEAD_OUT_IN) + (2 * arc_len_each) + L_in;

  return {
    pts: { START, T1, C1, E1, T2, C2, E2, END },
    metrics: {
      thetaDeg,
      R_in,
      L_in,
      rise_tangent_only,
      run_tangent_only,
      arc_rise_each,
      arc_run_each,
      true_offset,
      true_advance,
      arc_len_each,
      developed_len
    }
  };
}

function render(){
  const { pts, metrics } = buildGeometry();

  // Baseline
  setLine(baseline, {x:0, y:0}, {x:900, y:0});

  // Pipe path (line -> arc -> line -> arc -> line)
  const S = toScreen(pts.START);
  const T1s = toScreen(pts.T1);
  const E1s = toScreen(pts.E1);
  const T2s = toScreen(pts.T2);
  const E2s = toScreen(pts.E2);
  const ENDs = toScreen(pts.END);

  // Use SVG arc commands (radius is in px, handled in arcPath)
  const d = [
    `M ${S.x} ${S.y}`,
    `L ${T1s.x} ${T1s.y}`,
    arcPath(pts.C1, pts.T1, pts.E1, true), // CCW in math
    `L ${T2s.x} ${T2s.y}`,
    arcPath(pts.C2, pts.T2, pts.E2, false), // CW in math
    `L ${ENDs.x} ${ENDs.y}`,
  ].join(" ");

  pipe.setAttribute("d", d);

  // Markers
  setCircle(c1El, pts.C1);
  setCircle(c2El, pts.C2);
  setCircle(t1El, pts.T1);
  setCircle(t2El, pts.T2);
  setCircle(handleEl, pts.E1); // handle is end of first arc

  // Labels
  labelTheta.textContent = `θ = ${fmt(metrics.thetaDeg,1)}°`;
  labelHelp.textContent = `Drag the orange handle (end of first bend).`;

  // Panel values
  rVal.textContent = `${fmt(R_in,2)} in`;
  lVal.textContent = `${fmt(L_in,2)} in`;
  scaleVal.textContent = `${fmt(PX_PER_IN,0)} px/in`;

  metricsEl.innerHTML = [
metricsEl.innerHTML = `
<div class="group">
  <div class="group-title">FIELD MARKS</div>
  ${mrow("Angle", `${fmt(metrics.thetaDeg,1)}°`)}
  ${mrow("Dist. Between Bends", `${fmt(metrics.L_in,2)} in`)}
  ${mrow("Offset (Trig)", `${fmt(metrics.rise_tangent_only,3)} in`)}
  ${mrow("True Offset", `${fmt(metrics.true_offset,3)} in`)}
  ${mrow("Advance", `${fmt(metrics.true_advance,3)} in`)}
  ${mrow("Arc Length", `${fmt(metrics.arc_len_each,3)} in`)}
  ${mrow("Cut Length", `${fmt(metrics.developed_len,3)} in`)}
</div>

<div class="group">
  <div class="group-title">REFERENCE</div>
  ${mrow("CLR", `${fmt(metrics.R_in,2)} in`)}
  ${mrow("Horizontal Run", `${fmt(metrics.run_tangent_only,3)} in`)}
  ${mrow("Arc Rise", `${fmt(metrics.arc_rise_each,3)} in`)}
  ${mrow("Arc Advance", `${fmt(metrics.arc_run_each,3)} in`)}
</div>
`;
}

function mrow(k, v){
  return `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

// Drag: handle controls θ by rotating the first arc endpoint around C1
let dragging = false;

function getSvgPoint(evt){
  const pt = svg.createSVGPoint();
  const t = (evt.touches && evt.touches[0]) ? evt.touches[0] : evt;
  pt.x = t.clientX;
  pt.y = t.clientY;
  const ctm = svg.getScreenCTM();
  return pt.matrixTransform(ctm.inverse());
}

function onDown(e){
  // Only start drag if near handle
  const p = getSvgPoint(e);
  const hx = parseFloat(handleEl.getAttribute("cx"));
  const hy = parseFloat(handleEl.getAttribute("cy"));
  const dx = p.x - hx, dy = p.y - hy;
  if ((dx*dx + dy*dy) <= 22*22){
    dragging = true;
    svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
}

function onMove(e){
  if (!dragging) return;

  const pScreen = getSvgPoint(e);
  // We need C1 in screen coords
  const { pts } = buildGeometry();
  const c1s = toScreen(pts.C1);

  // Vector from center to pointer in screen coords
  const vx = pScreen.x - c1s.x;
  const vy = pScreen.y - c1s.y;

  // Convert to math coords (y up) for angle computation
  const vMath = { x: vx, y: -vy };

  // Reference start vector is (0, -R) in math coords (points down from center)
  // In math coords, start vector v1s = (0, -R). The current vector vMath gives θ.
  // θ = angle from (0,-1) to normalized(vMath), CCW positive
  // Compute using atan2 of cross/dot:
  const ref = { x: 0, y: -1 };
  const vm = (() => {
    const mag = Math.hypot(vMath.x, vMath.y);
    if (mag < 1e-6) return {x:0, y:-1};
    return { x: vMath.x / mag, y: vMath.y / mag };
  })();

  const dot = ref.x * vm.x + ref.y * vm.y;
  const cross = ref.x * vm.y - ref.y * vm.x; // z-component
  let ang = Math.atan2(cross, dot); // radians, CCW positive

  // We only want 0..90°
  let deg = ang * 180 / Math.PI;
  deg = clamp(deg, 0, 90);

  thetaDeg = deg;
  render();
  e.preventDefault();
}

function onUp(){
  dragging = false;
}

function onInputs(){
  R_in = parseFloat(rInput.value);
  L_in = parseFloat(lInput.value);
  PX_PER_IN = parseFloat(scaleInput.value);
  render();
}

// Event wiring
handleEl.addEventListener("pointerdown", onDown);
svg.addEventListener("pointermove", onMove);
svg.addEventListener("pointerup", onUp);
svg.addEventListener("pointercancel", onUp);
svg.addEventListener("pointerleave", onUp);

svg.addEventListener("touchstart", (e)=>{}, {passive:false}); // keep touch-action none effective

rInput.addEventListener("input", onInputs);
lInput.addEventListener("input", onInputs);
scaleInput.addEventListener("input", onInputs);

// Initial render
render();
