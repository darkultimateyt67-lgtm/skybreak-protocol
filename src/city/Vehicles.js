import * as THREE from 'three';
import { Chassis } from './Chassis.js';
import { Body } from '../physics/Rigid.js';
import { buildMotorcycle } from './Motorcycle.js';
import { WIND } from '../world/Wind.js';

/**
 * Vehicles — the cars of GTAZ, and the driving model behind them.
 *
 * The handling is deliberately arcade rather than a real tyre simulation:
 * speed along the body axis, a steer angle that only bites while moving, and
 * lateral grip that bleeds sideways velocity away. A proper slip-angle model
 * needs suspension and load transfer to feel like anything, and without those
 * it just feels broken — this reads as a car immediately.
 *
 * Collision reuses the existing capsule solver rather than adding a second
 * physics path: the car sweeps a capsule at its own radius, so it bumps off
 * the same walls the player does. Hitting something hard costs speed and,
 * above a threshold, wakes the police.
 */

/**
 * Ten chassis. Each is a different SHAPE and a different thing to drive, not
 * a reskin: a bus corners nothing like a bike, and that difference is carried
 * entirely by these numbers plus the per-chassis geometry in _build().
 *
 *   cabin  how far along the body the passenger box sits (0..1 of length)
 *   axles  wheel pairs — trucks and buses get three, bikes get one each end
 *   wheelR wheel radius as a fraction of body height. These were all about
 *          forty per cent too large — a muscle car carried a 0.92 m wheel
 *          against a 1.28 m roofline, so the tyre topped out ABOVE the
 *          beltline and every vehicle in the city had a monster-truck stance.
 *          Set from real tyre diameters: roughly 0.65 m on a car, 0.75 m on
 *          a 4x4, 1.0 m on a truck.
 */
/**
 * What the player's own car gets over a civilian one.
 *
 * Seven times the stock top speed, matching the on-foot multiplier, and a flat
 * acceleration rather than a scaled one — a bus and a supercar both pull
 * 110 m/s^2 here, so the difference between chassis becomes top end and grip
 * rather than how long you wait to get going.
 *
 * Deliberately NOT applied to the chassis table itself. Ambient traffic and
 * the AI that drives it are built around the stock figures: the route follower
 * steers toward the next junction node and would sail straight past every one
 * of them at seven times the speed, turning the city into a demolition derby
 * nobody asked for. FreeRoam applies these to the car you are sitting in.
 */
export const DRIVER_SPEED_SCALE = 7;
export const DRIVER_ACCEL = 110;

const CHASSIS = [
  { id: 'sedan',  l: 4.5, w: 1.9,  h: 1.35, mass: 1.00, topSpeed: 34, accel: 11.0, grip: 0.90, cabin: 0.46, axles: 2, wheelR: 0.245 },
  { id: 'coupe',  l: 4.3, w: 1.9,  h: 1.20, mass: 0.90, topSpeed: 42, accel: 15.0, grip: 0.93, cabin: 0.42, axles: 2, wheelR: 0.275 },
  { id: 'sport',  l: 4.2, w: 1.95, h: 1.10, mass: 0.80, topSpeed: 50, accel: 19.0, grip: 0.96, cabin: 0.38, axles: 2, wheelR: 0.3 },
  { id: 'muscle', l: 4.9, w: 2.00, h: 1.28, mass: 1.05, topSpeed: 46, accel: 17.0, grip: 0.84, cabin: 0.40, axles: 2, wheelR: 0.26 },
  { id: 'suv',    l: 4.9, w: 2.1,  h: 1.75, mass: 1.30, topSpeed: 30, accel: 9.0,  grip: 0.86, cabin: 0.52, axles: 2, wheelR: 0.215 },
  { id: 'pickup', l: 5.1, w: 2.1,  h: 1.70, mass: 1.25, topSpeed: 31, accel: 10.0, grip: 0.87, cabin: 0.38, axles: 2, wheelR: 0.225 },
  { id: 'van',    l: 5.4, w: 2.2,  h: 2.15, mass: 1.50, topSpeed: 26, accel: 7.5,  grip: 0.82, cabin: 0.62, axles: 2, wheelR: 0.17 },
  { id: 'truck',  l: 7.8, w: 2.45, h: 2.90, mass: 2.60, topSpeed: 22, accel: 5.0,  grip: 0.72, cabin: 0.30, axles: 3, wheelR: 0.175 },
  { id: 'bus',    l: 9.6, w: 2.55, h: 3.10, mass: 3.00, topSpeed: 20, accel: 4.2,  grip: 0.68, cabin: 0.86, axles: 3, wheelR: 0.165 },
  { id: 'bike',   l: 2.1, w: 0.72, h: 1.10, mass: 0.35, topSpeed: 54, accel: 22.0, grip: 0.88, cabin: 0.30, axles: 2, wheelR: 0.3 }
];

/**
 * Thirty vehicles you'll actually recognise on the street. Each pairs a
 * chassis with its own paint, trim and roof fitting, so two sedans are still
 * visibly two different cars rather than the same car twice.
 */
const CATALOG = [
  { name: 'VERANO',      chassis: 'sedan',  paint: 0xb8352f, trim: 0x2a2d33, roof: null },
  { name: 'CIVIC LINE',  chassis: 'sedan',  paint: 0x1f4f8c, trim: 0x1a1c20, roof: null },
  { name: 'ASHGROVE',    chassis: 'sedan',  paint: 0xd9d4c8, trim: 0x3a3f46, roof: 'rack' },
  { name: 'TAXI 401',    chassis: 'sedan',  paint: 0xe8b21c, trim: 0x14161a, roof: 'sign' },
  { name: 'PATROL',      chassis: 'sedan',  paint: 0x1b1f2a, trim: 0xe8e8ea, roof: 'bar' },
  { name: 'KESTREL',     chassis: 'coupe',  paint: 0x2e6b4f, trim: 0x15171c, roof: null },
  { name: 'MERIDIAN',    chassis: 'coupe',  paint: 0x8e4b9e, trim: 0x22252b, roof: null },
  { name: 'DUSKFALL',    chassis: 'coupe',  paint: 0x1a1c20, trim: 0xc9a227, roof: null },
  { name: 'VOLT GT',     chassis: 'sport',  paint: 0xd06a2c, trim: 0x101216, roof: 'wing' },
  { name: 'SABLE S9',    chassis: 'sport',  paint: 0xe8e4dc, trim: 0x2b2f36, roof: 'wing' },
  { name: 'NOVA RS',     chassis: 'sport',  paint: 0xc21f3a, trim: 0x101216, roof: 'wing' },
  { name: 'PHANTOM X',   chassis: 'sport',  paint: 0x141821, trim: 0x9fefff, roof: 'wing' },
  { name: 'BRUISER',     chassis: 'muscle', paint: 0x2b6ea8, trim: 0xe8e4dc, roof: 'scoop' },
  { name: 'IRONHIDE',    chassis: 'muscle', paint: 0x3a3f46, trim: 0xc9a227, roof: 'scoop' },
  { name: 'REDLINE 68',  chassis: 'muscle', paint: 0xa8231c, trim: 0x1a1c20, roof: 'scoop' },
  { name: 'RANGER XL',   chassis: 'suv',    paint: 0x3d5a6c, trim: 0x1a1c20, roof: 'rack' },
  { name: 'SUMMIT',      chassis: 'suv',    paint: 0x6f7a80, trim: 0x2a2d33, roof: 'rack' },
  { name: 'HAVEN 4X4',   chassis: 'suv',    paint: 0x2e4a2c, trim: 0x14161a, roof: 'rack' },
  { name: 'MULE 250',    chassis: 'pickup', paint: 0xc9a227, trim: 0x2a2d33, roof: null },
  { name: 'YARDMAN',     chassis: 'pickup', paint: 0xd9d4c8, trim: 0x6f7a80, roof: 'bar' },
  { name: 'DUSTBOWL',    chassis: 'pickup', paint: 0x8a5a2f, trim: 0x1a1c20, roof: null },
  { name: 'COURIER',     chassis: 'van',    paint: 0xe8e4dc, trim: 0x2b6ea8, roof: null },
  { name: 'NIGHT SHIFT', chassis: 'van',    paint: 0x2b2f36, trim: 0x15171c, roof: 'rack' },
  { name: 'BLOOMWAGON',  chassis: 'van',    paint: 0x3f7a4a, trim: 0xe8e4dc, roof: 'rack' },
  { name: 'HAULER 900',  chassis: 'truck',  paint: 0x1f4f8c, trim: 0x9aa2ab, roof: 'stack' },
  { name: 'GRIT & CO',   chassis: 'truck',  paint: 0xa8231c, trim: 0x2a2d33, roof: 'stack' },
  { name: 'CROSSTOWN',   chassis: 'bus',    paint: 0xe8b21c, trim: 0x2a2d33, roof: 'vent' },
  { name: 'NIGHT OWL',   chassis: 'bus',    paint: 0x2b3550, trim: 0x9fefff, roof: 'vent' },
  { name: 'WASP 400',    chassis: 'bike',   paint: 0xc21f3a, trim: 0x14161a, roof: null, bike: 'sport' },
  { name: 'DRIFTER',     chassis: 'bike',   paint: 0x1a1c20, trim: 0xd06a2c, roof: null, bike: 'naked' },
  { name: 'LONGHAUL',    chassis: 'bike',   paint: 0x2a1d17, trim: 0xc9a227, roof: null, bike: 'cruiser' }
];

/** Spawn frequency per chassis. Cars are common, heavy vehicles are not. */
const WEIGHTED = {
  sedan: 1.0, coupe: 0.8, sport: 0.5, muscle: 0.5, suv: 0.8,
  pickup: 0.7, van: 0.5, truck: 0.22, bus: 0.16, bike: 0.75
};

const _v = new THREE.Vector3();
const _pillarDir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
import { models } from './ModelLibrary.js';

const _prev = new THREE.Vector3();
const _probe = new THREE.Vector3();

/**
 * BODY SIDE PROFILES — GENERATED, NOT HAND-WRITTEN.
 *
 * These used to be literal polylines typed in per chassis, and they had
 * quietly drifted out of step with where the cabin is actually built. The
 * sedan's raised shoulder ran from 44% to 84% of its length, but its glass
 * sits from 23% to 69%: the back half of the glasshouse hung in the air over
 * a boot 20 cm lower, and a flat raised plateau stood in front of the
 * windscreen with nothing on it. That mismatch is most of what made every car
 * read as a brick with a box balanced on top.
 *
 * So the roofline is built from the same numbers the cabin is: the shoulder
 * spans exactly the glasshouse, and the deck behind it and the bonnet in front
 * sit a few centimetres below the belt, the way a real body is one
 * near-continuous height down its side. Every consumer (lights, bumpers,
 * mirrors, occupants, interior, the greenhouse) reads these, so they agree by
 * construction instead of by luck.
 *
 * Heights are fractions of chassis height, measured off real cars: sills
 * around 14%, bonnet and boot deck just under a belt at about two thirds.
 */
const BODY = {
  sedan:  { sill: 0.14, tail: 0.50, deck: 0.62, belt: 0.66, bonnet: 0.63, nose: 0.50 },
  coupe:  { sill: 0.14, tail: 0.48, deck: 0.60, belt: 0.66, bonnet: 0.62, nose: 0.48 },
  sport:  { sill: 0.13, tail: 0.46, deck: 0.58, belt: 0.64, bonnet: 0.60, nose: 0.42 },
  muscle: { sill: 0.14, tail: 0.52, deck: 0.63, belt: 0.66, bonnet: 0.64, nose: 0.54 },
  suv:    { sill: 0.16, tail: 0.56, deck: 0.64, belt: 0.68, bonnet: 0.64, nose: 0.56 },
  pickup: { sill: 0.16, tail: 0.58, deck: 0.58, belt: 0.68, bonnet: 0.64, nose: 0.56 },
  van:    { sill: 0.12, tail: 0.66, deck: 0.70, belt: 0.72, bonnet: 0.62, nose: 0.52 },
  truck:  { sill: 0.12, tail: 0.60, deck: 0.62, belt: 0.72, bonnet: 0.66, nose: 0.58 },
  bus:    { sill: 0.10, tail: 0.70, deck: 0.72, belt: 0.72, bonnet: 0.72, nose: 0.64 }
};

/** Where the glasshouse sits, as fractions of length (tail = 0, nose = 1). */
export function cabinSpan(c) {
  const cz = c.id === 'bus' ? 0 : (c.id === 'truck' ? 0.26 : -0.04);
  return [0.5 + cz - c.cabin / 2, 0.5 + cz + c.cabin / 2];
}

function buildProfile(c) {
  const b = BODY[c.id];
  const [c0, c1] = cabinSpan(c);
  const pts = [[0, b.sill], [0, b.tail]];
  pts.push([Math.min(0.05, c0 * 0.5), (b.tail + b.deck) / 2]);
  if (c0 > 0.08) pts.push([c0 - 0.02, b.deck]);
  pts.push([c0, b.belt]);
  pts.push([c1, b.belt]);
  if (c1 < 0.92) pts.push([c1 + 0.02, b.bonnet]);
  pts.push([Math.max(0.95, c1 + 0.03), (b.bonnet + b.nose) / 2]);
  pts.push([1, b.nose]);
  pts.push([1, b.sill]);
  return pts;
}

const PROFILES = {
  bike: [[0, 0.20], [0.10, 0.46], [0.34, 0.52], [0.58, 0.62], [0.78, 0.56], [0.94, 0.40], [1, 0.24], [0.60, 0.16], [0.20, 0.16]]
};
for (const c of CHASSIS) if (BODY[c.id]) PROFILES[c.id] = buildProfile(c);

/**
 * LOFTED BODY SHELL, WITH REAL WHEEL ARCHES.
 *
 * A cross-section swept along the length. Three things in the section do most
 * of the work of reading as a car rather than a slab:
 *
 *   A FLAT DOOR SKIN. The side runs nearly vertical from sill to shoulder and
 *   is rounded only at its top and bottom edges. The previous squircle rounded
 *   the WHOLE section, so the side was a tube and the visible flank shrank to
 *   a thin band thinner than the wheels, which is why it looked like a plank
 *   lying across them.
 *
 *   WHEEL ARCHES CUT INTO IT. Near each axle the underside of the section lifts
 *   in a semicircle over the tyre, so the arch is an actual opening in the body
 *   with the wheel sitting inside it. Before, the body stopped in a flat bottom
 *   edge and the tyres stuck out below it.
 *
 *   FENDERS OVER THEM. Where an arch would break through the bonnet (every low
 *   car, since a 66 cm wheel is most of a 1.1 m body) the outer edge of the
 *   section rises over the tyre while the centre stays at bonnet height. That
 *   is the bulge-over-the-wheel shape of a real front wing.
 *
 * WINDING. The side quads are wound so their normals face OUT. The previous
 * shell had them facing in: from outside the near wall was a back face and got
 * culled, so you looked straight through it at the inside of the far wall and
 * the far-side wheels. That is why four wheels showed from side-on.
 */
/*
 * UNDERSIDE AND ENGINE BAY. The section's underside is flat at sill height
 * across the middle of the car and only steps up to the arch OUTBOARD of the
 * tyre's inner face. That is where a wheel well actually is: at the sides.
 * Lifting the whole underside over each axle turned every arch into a tunnel
 * through the car, and left no depth anywhere under the bonnet for an engine.
 *
 * With the floor kept low in the middle, the top of the section can be carved
 * down between the wells to make a real engine bay: a shelf over each wheel
 * housing, then a drop to a floor, closed at the back by the firewall and at
 * the front by the radiator panel. The bonnet is a separate lid over it.
 */
const STATIONS = 22;
const TYRE_W = 0.28;

/** Half-width multiplier along the body: nose pinch, hips, tail tuck. */
function planWidth(t) {
  if (t < 0.12) return 0.82 + (t / 0.12) * 0.14;
  if (t < 0.30) return 0.96 + ((t - 0.12) / 0.18) * 0.04;
  if (t < 0.62) return 1.0;
  if (t < 0.86) return 1.0 - ((t - 0.62) / 0.24) * 0.07;
  return 0.93 - ((t - 0.86) / 0.14) * 0.15;
}

const ARC_N = 2;                   // points per rounded edge, minus one
const IDX_BOTTOM_ARC = 3;          // first point of the sill radius
const IDX_TOP_ARC = ARC_N + 4;     // first point of the shoulder radius
const IDX_TOP_ARC_END = 2 * ARC_N + 4;

function makeBody(profile, len, height, width, opts = {}) {
  const halfLen = len / 2;
  const halfW = width / 2;
  const upper = profile.slice(1, -1);
  const sillBase = profile[0][1] * height;
  const axles = opts.axles || [];
  const hard = !!opts.hard;
  const bay = opts.bay || null;
  const xWell = opts.xWell ?? halfW * 0.66;
  const N = ARC_N;
  const GAP = 0.05;       // tyre-to-arch clearance
  const SKIN = 0.10;      // fender thickness over the arch

  const roofAt = (t) => {
    if (t <= upper[0][0]) return upper[0][1] * height;
    for (let i = 1; i < upper.length; i++) {
      if (t <= upper[i][0]) {
        const [x0, y0] = upper[i - 1];
        const [x1, y1] = upper[i];
        const k = x1 === x0 ? 0 : (t - x0) / (x1 - x0);
        return (y0 + (y1 - y0) * k) * height;
      }
    }
    return upper[upper.length - 1][1] * height;
  };
  const archAt = (z) => {
    let y = 0;
    for (const a of axles) {
      const R = a.r + GAP;
      const dz = z - a.z;
      if (Math.abs(dz) < R) y = Math.max(y, a.y + Math.sqrt(R * R - dz * dz));
    }
    return y;
  };
  const fenderAt = (z, top) => {
    let need = 0;
    for (const a of axles) {
      const R = a.r + GAP + SKIN;
      const dz = z - a.z;
      if (Math.abs(dz) < R) need = Math.max(need, a.y + Math.sqrt(R * R - dz * dz) - top);
    }
    return Math.max(0, need);
  };

  /** The right half of the cross-section at z, bottom centre to top centre. */
  const section = (z, carve) => {
    const t = THREE.MathUtils.clamp((z + halfLen) / len, 0, 1);
    const top = roofAt(t);
    const peak = top + fenderAt(z, top);
    let bottom = Math.max(sillBase, archAt(z));
    if (bottom > peak - 0.07) bottom = peak - 0.07;
    const H = peak - bottom;
    const hw = halfW * planWidth(t);
    const hwB = hw * (hard ? 0.99 : 0.955);    // at the sill
    const hwT = hw * (hard ? 0.97 : 0.90);     // at the shoulder: tumblehome
    const rb = Math.min(hard ? 0.05 : 0.09, H * 0.28);
    const rt = Math.min(hard ? 0.07 : 0.15, H * 0.36);
    const cornerX = hwT - rt;
    const centreY = top + (hard ? 0 : height * 0.016);
    const under = Math.min(sillBase, bottom);
    const xw = Math.max(0.08, Math.min(xWell, cornerX * 0.9, (hwB - rb) * 0.9));
    const q3 = Math.max(0.01, xw - 0.06);
    const q2 = Math.max(q3 + 0.01, xw - 0.03);
    const q1 = Math.max(q2 + 0.01, Math.min(xw + 0.02, cornerX * 0.97));

    const inBay = !!(carve && bay && z >= bay.z0 && z <= bay.z1);
    let floorY = 0;
    let shelfY = 0;
    if (inBay) {
      floorY = Math.min(peak - 0.05, Math.max(under + 0.12, top - bay.depth));
      shelfY = Math.min(peak - 0.02, Math.max(floorY, bottom + 0.05));
    }
    const crownY = (x) => {
      const u = 1 - x / cornerX;
      const sm = u * u * (3 - 2 * u);
      return peak + (centreY - peak) * sm;
    };

    const right = [[0, under], [xw, under], [xw, bottom]];
    for (let k = 0; k <= N; k++) {
      const a = -Math.PI / 2 + (k / N) * (Math.PI / 2);
      right.push([hwB - rb + Math.cos(a) * rb, bottom + rb + Math.sin(a) * rb]);
    }
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * (Math.PI / 2);
      right.push([cornerX + Math.cos(a) * rt, peak - rt + Math.sin(a) * rt]);
    }
    if (inBay) {
      right.push([q1, shelfY], [q2, shelfY], [q3, floorY], [0, floorY]);
    } else {
      right.push([q1, crownY(q1)], [q2, crownY(q2)], [q3, crownY(q3)], [0, centreY]);
    }
    return { z, t, top, peak, bottom, under, hw, hwB, hwT, rb, rt, cornerX, centreY, xw, q3, floorY, inBay, right };
  };

  /** Outer surface x of the flank at height y. */
  const flankX = (z, y) => {
    const r = section(z, false).right;
    if (y <= r[IDX_BOTTOM_ARC][1]) return r[IDX_BOTTOM_ARC][0];
    for (let k = IDX_BOTTOM_ARC + 1; k <= IDX_TOP_ARC_END; k++) {
      if (y <= r[k][1]) {
        const [x0, y0] = r[k - 1];
        const [x1, y1] = r[k];
        const f = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        return x0 + (x1 - x0) * f;
      }
    }
    return r[IDX_TOP_ARC_END][0];
  };

  /** Height of the closed upper surface at lateral offset x. */
  const topAt = (z, x) => {
    const r = section(z, false).right;
    const ax = Math.abs(x);
    const last = r.length - 1;
    if (ax >= r[IDX_TOP_ARC][0]) return r[IDX_TOP_ARC][1];
    for (let k = IDX_TOP_ARC + 1; k <= last; k++) {
      if (ax >= r[k][0]) {
        const [x0, y0] = r[k - 1];
        const [x1, y1] = r[k];
        const f = x0 === x1 ? 0 : (ax - x0) / (x1 - x0);
        return y0 + (y1 - y0) * f;
      }
    }
    return r[last][1];
  };

  /** Engine bay floor and usable half-width at z. */
  const bayAt = (z) => {
    const sec = section(z, true);
    return { floor: sec.inBay ? sec.floorY : sec.top, inner: sec.q3 };
  };

  const stationZs = () => {
    const zs = [];
    for (let i = 0; i <= STATIONS; i++) zs.push(-halfLen + (i / STATIONS) * len);
    // Extra slices through each arch so it reads round rather than faceted.
    for (const a of axles) {
      const R = a.r + GAP + SKIN;
      for (let k = -4; k <= 4; k++) zs.push(a.z + (k / 4.3) * R);
    }
    // Near-coincident pairs at the bay ends give the firewall and radiator
    // panel crisp vertical faces instead of a ramp spread over a whole slice.
    if (bay) zs.push(bay.z0 - 0.004, bay.z0 + 0.004, bay.z1 - 0.004, bay.z1 + 0.004);
    zs.sort((p, q) => p - q);
    const out = [];
    for (const z of zs) {
      if (z < -halfLen - 1e-6 || z > halfLen + 1e-6) continue;
      if (!out.length || z - out[out.length - 1] > 0.005) out.push(z);
    }
    return out;
  };

  const geometry = () => {
    const rings = stationZs().map((z) => {
      const r = section(z, true).right;
      const ring = r.slice();
      for (let k = r.length - 2; k >= 1; k--) ring.push([-r[k][0], r[k][1]]);
      return { z, ring };
    });
    const S = rings.length - 1;
    const RING = rings[0].ring.length;
    const pos = [];
    for (const { z, ring } of rings) for (const [x, y] of ring) pos.push(x, y, z);
    const idx = [];
    for (let i = 0; i < S; i++) {
      for (let k = 0; k < RING; k++) {
        const a = i * RING + k;
        const b = i * RING + ((k + 1) % RING);
        const c = a + RING;
        const d = b + RING;
        idx.push(a, b, c, b, d, c);          // outward-facing
      }
    }
    const mid = (r) => {
      let lo = Infinity, hi = -Infinity;
      for (const [, y] of r) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      return (lo + hi) / 2;
    };
    const capTail = pos.length / 3;
    pos.push(0, mid(rings[0].ring), rings[0].z);
    const capNose = pos.length / 3;
    pos.push(0, mid(rings[S].ring), rings[S].z);
    for (let k = 0; k < RING; k++) {
      idx.push(capTail, (k + 1) % RING, k);
      idx.push(capNose, S * RING + k, S * RING + ((k + 1) % RING));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };

  return { section, flankX, topAt, bayAt, geometry, halfLen };
}

function shellGeometry(profile, len, height, width, opts = {}) {
  return makeBody(profile, len, height, width, opts).geometry();
}

/**
 * A curved patch, sampled from a surface function over a u/v grid and turned
 * so it faces the given direction. Door skins, bonnet lids, shut lines and
 * sills are all built this way, which is what lets them lie ON the body's
 * curvature instead of being flat boxes standing off it.
 */
function gridPatch(cols, rows, pointAt, outward) {
  const pos = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) pos.push(...pointAt(i / cols, j / rows));
  }
  const W = cols + 1;
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const at = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const A = at(0);
  const n = new THREE.Vector3().subVectors(at(1), A).cross(new THREE.Vector3().subVectors(at(W), A));
  if (n.dot(outward) < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Doors per chassis. Buses, trucks and bikes keep their fixed bodies. */
const DOOR_COUNT = { sedan: 4, suv: 4, coupe: 2, sport: 2, muscle: 2, pickup: 2, van: 2 };
/** Front-engined cars get an opening bonnet and an engine under it. */
const BONNET_CHASSIS = new Set(['sedan', 'coupe', 'sport', 'muscle', 'suv', 'pickup']);

/**
 * Cars with a door or bonnet moving right now. Kept as a set so the per-frame
 * cost is the handful of cars actually animating, not all 255 in the city.
 */
const _animatingPanels = new Set();
export function tickVehiclePanels(dt) {
  for (const v of [..._animatingPanels]) v.tickPanels(dt);
}

export class Vehicle {
  constructor(city, x, z, styleId = null, opts = {}) {
    this.city = city;
    this.game = city.game;
    // Pick a catalogue entry, then resolve its chassis. `styleId` may name
    // either a catalogue vehicle or a chassis, so callers can ask for "a bus"
    // or for "CROSSTOWN" specifically.
    let entry = null;
    if (styleId) {
      entry = CATALOG.find((c) => c.name === styleId)
           || CATALOG.find((c) => c.chassis === styleId);
    }
    if (!entry) {
      // Buses, trucks and bikes are rarer than cars — a street where every
      // third vehicle is a coach reads as a depot, not a city.
      const pool = opts.anyType ? CATALOG : CATALOG.filter((c) => WEIGHTED[c.chassis] > Math.random());
      entry = (pool.length ? pool : CATALOG)[(Math.random() * (pool.length || CATALOG.length)) | 0];
    }
    this.entry = entry;
    this.name = entry.name;
    const found = CHASSIS.find((c) => c.id === entry.chassis) || CHASSIS[0];
    // Copied, not referenced: the police tune topSpeed per wanted level, and
    // sharing the table entry would hand that speed to every civilian sedan.
    this.style = { ...found };

    this.position = new THREE.Vector3(x, 0, z);
    this.yaw = 0;
    this.speed = 0;            // m/s along the body axis, signed
    this.steer = 0;
    this.lateral = 0;          // sideways drift, bled off by grip
    this.driver = null;        // 'player' | 'ai' | null
    this.isPolice = !!opts.police;
    this.health = 100;
    this.maxHealth = 100;
    // Most any single impact may take, as a fraction of max health.
    this.impactCap = 0.6;
    this.alive = true;
    this.wheelSpin = 0;
    this._vel = new THREE.Vector3();
    this._res = { onGround: false, hitCeiling: false, wallNormal: null, wallRunOK: false };

    this.group = new THREE.Group();
    // Past draw distance the whole car is hidden; skip its transforms too.
    this.group.skipWhenHidden = true;
    // An artist-made body if one was dropped in for this chassis; otherwise
    // the generated one. Wheels, interior and occupants are still built
    // either way — a downloaded shell doesn't come with a steering wheel the
    // cockpit camera can look at.
    this.usingModel = false;
    const swap = models.instance(this.style.id, this.style.l);
    if (swap) {
      this.group.add(swap);
      this.usingModel = true;
    }
    this.panels = [];
    this.panelStatic = [];
    this._build(opts);
    this._mergeStatic();
    // Suspension, weight transfer, air time and rollover. Built after the
    // body, because it reads the wheels' rest positions off the meshes.
    this.chassis = new Chassis(this);
    this.tumbling = false;
    this.tumbleBody = null;
    this._rightAt = 0;
    this.game.scene.add(this.group);
    this.syncMesh();
  }

  /**
   * Bake this vehicle's fixed parts into one mesh per material.
   *
   * Every detail pass — arches, spokes, mirrors, door seams, the interior —
   * added meshes to EVERY car, and there are over a hundred cars. That came
   * to 97 meshes each and 10,443 across the city, dwarfing the entire merged
   * world at 1,306 and undoing the draw-call work outright.
   *
   * Only genuinely static, opaque parts are folded in. Wheels and the
   * steering wheel rotate, occupants toggle visibility, and glass has to
   * stay separate so transparency still sorts — all of those are left alone.
   */
  _mergeStatic() {
    const keep = new Set();
    for (const w of this.wheels || []) keep.add(w.mesh);
    if (this.wheelRig) keep.add(this.wheelRig);
    if (this.occupants) keep.add(this.occupants);
    for (const m of this.panelStatic || []) keep.add(m);

    const byMat = new Map();
    const doomed = [];
    for (const child of this.group.children) {
      if (!child.isMesh || keep.has(child)) continue;
      const m = child.material;
      if (!m || Array.isArray(m) || m.transparent) continue;
      if (!child.geometry?.attributes?.position) continue;
      child.updateMatrix();
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrix);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) {
        const n = geo.attributes.position.count;
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(geo);
      doomed.push(child);
    }

    let folded = 0;
    for (const [mat, list] of byMat) {
      if (list.length < 2) { for (const gg of list) gg.dispose(); continue; }
      const merged = mergeParts(list);
      for (const gg of list) gg.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      folded++;
    }
    for (const d of doomed) {
      if (byMat.get(d.material)?.length >= 2) this.group.remove(d);
    }
    this.mergedInto = folded;
  }

  _build(opts) {
    const s = this.style;
    const e = this.entry;
    const paint = this.isPolice ? 0x1b1f2a : e.paint;
    // Real car paint is a metallic basecoat under a glossy clear layer. That
    // second layer is why a car has a sharp bright reflection sitting on top
    // of its colour instead of a single dull sheen — MeshPhysicalMaterial's
    // clearcoat models exactly that, and it is the biggest single upgrade
    // available to how these read.
    const body = new THREE.MeshPhysicalMaterial({
      color: paint, roughness: 0.34, metalness: 0.55,
      clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.5
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: e.trim, roughness: 0.4, metalness: 0.6,
      clearcoat: 0.6, clearcoatRoughness: 0.15
    });
    // Brightwork. At roughness 0.08 with 2.2x environment this was a mirror,
    // and since it is mostly used on wheel rims every car in the city had two
    // blank white discs down its side that blew out to pure white in sunlight.
    // Alloy is a brushed metal, not a mirror: rougher, and no longer
    // over-driven against the environment.
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xc2c8cf, roughness: 0.32, metalness: 0.95, envMapIntensity: 1.15
    });
    // Two different glasses, because they do two different jobs.
    //
    // SIDE AND REAR are mirrors: near-zero roughness and full metalness makes
    // them pick up scene.environment, so they catch the sky and the buildings
    // as you drive past. Being hard to see into is correct for them.
    //
    // The WINDSCREEN is the opposite — it has to be genuinely see-through,
    // because in the chase camera you look through the rear glass, the cabin
    // and the screen to the road ahead. A uniformly tinted greenhouse put a
    // dark band across exactly the part of the road you steer by.
    // Glass, not chrome. At metalness 1 these were mirrors: fine from the
    // pavement, but from the driver's seat the side window became a solid
    // white panel filling a quarter of the screen. Real glass gets its shine
    // from a CLEARCOAT layer over a transparent base — you see the reflection
    // and the street behind it at the same time.
    // TINTED, NOT CLEAR. At 20% opacity the side and rear glass were nearly
    // invisible, so from the street the cabin read as an empty frame — a thin
    // roof on sticks over nothing, like an open vintage roadster. Real car
    // glass seen from outside is a dark, reflective panel you can only just
    // see into; that solid-looking greenhouse is a large part of what makes a
    // shape read as a modern car at all. The windscreen stays clear (below),
    // because that is the one you look through.
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x243441, roughness: 0.03, metalness: 0.12,
      transparent: true, opacity: 0.72,
      clearcoat: 1.0, clearcoatRoughness: 0.02,
      envMapIntensity: 2.0, depthWrite: false
    });
    // Reflective from outside, invisible from inside. The canopy is single-
    // sided, so the driver looking out never sees this face at all — which
    // means it can behave like real windscreen glass from the street, catching
    // the sky, instead of an 84%-clear window onto a dark interior that read
    // as a hole in the front of the cabin.
    const windscreen = new THREE.MeshPhysicalMaterial({
      color: 0x4d6272, roughness: 0.03, metalness: 0.15,
      transparent: true, opacity: 0.5,
      clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 1.9,
      depthWrite: false
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85, metalness: 0.2 });
    const lamp = new THREE.MeshStandardMaterial({
      color: 0x201d10, emissive: 0xfff0c0, emissiveIntensity: 1.4, roughness: 0.3
    });
    const tail = new THREE.MeshStandardMaterial({
      color: 0x2a0805, emissive: 0xff3320, emissiveIntensity: 1.3, roughness: 0.4
    });
    // Number plate. Faintly self-lit so it still reads at dusk and under the
    // city's own shadow, which is when you are most often looking at the back
    // of a car.
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xd8d6c8, emissive: 0x3a3a33, emissiveIntensity: 0.5, roughness: 0.7
    });

    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };

    if (s.id === 'bike') {
      // A motorcycle has nothing in common with a car's body shell, so it is
      // built by its own module: frame, engine, pipes, chain, brakes,
      // suspension, a steering front end, a rider, and the lean and side
      // stand that make it behave like a bike rather than a car on two wheels.
      this.bike = buildMotorcycle(this, {
        body, accent, chrome, trim, lamp, tail, plate: plateMat
      }, e.bike || 'sport');
    } else {
      // Lower body: an extruded, bevelled profile — sloped bonnet, curved
      // fenders, boot drop — instead of a rectangular block. Skipped entirely
      // when a real model is standing in for it.
      // The body is kept as a queryable shape, not just a mesh: doors, the
      // bonnet, sills, lights and bumpers all ask it where the surface is.
      const [bodyC0, bodyC1] = cabinSpan(s);
      const bayZ = (!this.usingModel && BONNET_CHASSIS.has(s.id))
        ? [(bodyC1 - 0.5) * s.l + 0.03, s.l * 0.5 - 0.14] : null;
      this.bodyShape = makeBody(PROFILES[s.id] || PROFILES.sedan, s.l, s.h, s.w, {
        hard: ['van', 'truck', 'bus', 'pickup'].includes(s.id),
        axles: [s.l * 0.31, -s.l * 0.31, ...(s.axles >= 3 ? [-s.l * 0.44] : [])]
          .map((z) => ({ z, r: s.h * s.wheelR, y: s.h * s.wheelR })),
        xWell: s.w * 0.5 - TYRE_W * 0.95 - 0.06,
        bay: bayZ ? { z0: bayZ[0] - 0.01, z1: bayZ[1], depth: s.h * 0.34 } : null
      });
      this._bayZ = bayZ;
      if (!this.usingModel) {
        const shell = new THREE.Mesh(this.bodyShape.geometry(), body);
        shell.castShadow = true;
        shell.receiveShadow = true;
        this.group.add(shell);
      }
      const cabinL = s.l * s.cabin;
      // Buses and vans carry their cabin over the whole body and sit it
      // forward; cars set it back behind the bonnet.
      const cabinZ = s.id === 'bus' ? 0 : (s.id === 'truck' ? s.l * 0.26 : -s.l * 0.04);
      // --- Cabin -------------------------------------------------------------
      // One swept canopy rather than a roof slab on four sticks: see
      // _buildCanopy. The belt is the body's own shoulder, so the glass starts
      // exactly where the paint stops.
      const prof = PROFILES[s.id] || PROFILES.sedan;
      const shoulder = Math.max(...prof.map((pt) => pt[1]));
      const beltY = s.h * shoulder;
      const doorCount = this.usingModel ? 0 : (DOOR_COUNT[s.id] || 0);
      if (!this.usingModel) {
        const glaze = this._buildCanopy({ body, trim, chrome, glass, windscreen, cabinZ, cabinL, beltY, doorCount });
        this._buildPanels({ body, trim, chrome, glass, glaze, doorCount });
      }

      // Trucks get a separate cargo box behind the cab; buses get a side stripe.
      if (s.id === 'truck') {
        add(new THREE.BoxGeometry(s.w * 1.0, s.h * 0.72, s.l * 0.52), accent, 0, s.h * 0.52, -s.l * 0.20);
      } else if (s.id === 'bus') {
        add(new THREE.BoxGeometry(s.w * 1.01, s.h * 0.1, s.l * 0.92), accent, 0, s.h * 0.62, 0);
      } else if (s.id === 'pickup') {
        // Open bed: floor plus low sides.
        add(new THREE.BoxGeometry(s.w * 0.96, s.h * 0.16, s.l * 0.40), accent, 0, s.h * 0.66, -s.l * 0.28);
      }
    }

    // Lights.
    // LIGHTS, PLACED ON THE BODY RATHER THAN NEAR IT.
    //
    // These were fixed fractions of height chosen against the old inflated
    // cabin. The nose of a sedan tops out at 0.44 of its height — 0.59 m — and
    // the headlights sat at 0.46, so they hung in the air above the bonnet;
    // the tail is lower still at 0.34, and the rear lamps floated 0.22 m off
    // the back of the car. Reading the front and rear faces out of the side
    // profile puts every lamp on the panel it belongs to, at any chassis.
    const profPts = PROFILES[s.id] || PROFILES.sedan;
    const faceLo = Math.min(...profPts.map((pt) => pt[1]));
    const noseTop = Math.max(...profPts.filter((pt) => pt[0] >= 0.95).map((pt) => pt[1]));
    const tailTop = Math.max(...profPts.filter((pt) => pt[0] <= 0.05).map((pt) => pt[1]));
    const onFace = (top, frac) => s.h * (faceLo + (top - faceLo) * frac);
    const headY = onFace(noseTop, 0.62);
    const tailY = onFace(tailTop, 0.66);

    // Lamps sized to the nose and tail they sit on. As fractions of the full
    // width they overhung a nose that pinches to under 80% of it.
    const shp = this.bodyShape;
    const noseHalf = shp ? shp.section(s.l * 0.5 - 0.05, false).hwB : s.w * 0.4;
    const tailHalf = shp ? shp.section(-s.l * 0.5 + 0.05, false).hwB : s.w * 0.4;
    for (const side of (s.id === 'bike' ? [] : [-1, 1])) {
      add(new THREE.BoxGeometry(noseHalf * 0.56, 0.13, 0.08), lamp, side * noseHalf * 0.60, headY, s.l * 0.5 + 0.012);
      add(new THREE.BoxGeometry(tailHalf * 0.55, 0.12, 0.07), tail, side * tailHalf * 0.62, tailY, -s.l * 0.5 - 0.012);
    }

    // --- Bumpers, plates and a swage line -----------------------------------
    //
    // A car body is not a single coloured shape, and until it has a horizontal
    // break in it that is exactly what it reads as. Three cheap additions do
    // most of that work:
    //
    // BUMPERS give the car a dark base, so the paint reads as the upper body
    // rather than the whole silhouette, and they define where the car ends.
    // PLATES are the detail that says "vehicle" faster than anything else on
    // it, because nothing else in the world is a small bright rectangle at
    // knee height. And the SWAGE LINE — the crease every real car has running
    // down its flank — catches light along its length, which breaks up the one
    // big flat panel you spend most of your time looking at.
    if (s.id !== 'bike') {
      const bumpF = onFace(noseTop, 0.2);
      const bumpR = onFace(tailTop, 0.22);
      // Bumpers wrap the nose and tail they belong to. Full-width boxes hung
      // twenty centimetres off each side of a body that tapers at both ends.
      add(new THREE.BoxGeometry(noseHalf * 2 + 0.04, s.h * 0.12, 0.16), trim, 0, bumpF, s.l * 0.5 - 0.01);
      add(new THREE.BoxGeometry(tailHalf * 2 + 0.04, s.h * 0.12, 0.16), trim, 0, bumpR, -s.l * 0.5 + 0.01);
      for (const side of [-1, 1]) {
        const fx = shp ? shp.section(s.l * 0.5 - 0.2, false).hwB : s.w * 0.44;
        const rx = shp ? shp.section(-s.l * 0.5 + 0.2, false).hwB : s.w * 0.44;
        add(new THREE.BoxGeometry(0.10, s.h * 0.12, 0.34), trim, side * (fx - 0.02), bumpF, s.l * 0.5 - 0.17);
        add(new THREE.BoxGeometry(0.10, s.h * 0.12, 0.34), trim, side * (rx - 0.02), bumpR, -s.l * 0.5 + 0.17);
      }
      add(new THREE.BoxGeometry(s.w * 0.26, s.h * 0.09, 0.03), plateMat, 0, bumpF, s.l * 0.5 + 0.08);
      add(new THREE.BoxGeometry(s.w * 0.26, s.h * 0.09, 0.03), plateMat, 0, bumpR, -s.l * 0.5 - 0.08);
      // NO PAINTED SWAGE LINE. It was a strip of the vehicle's ACCENT colour
      // laid along the flank, which on a white van rendered as a bright blue
      // bar stuck to the side. A swage is a crease in the panel, not a stripe
      // in a contrasting colour — and the lofted body has real curvature down
      // its flank now, so the light does this job properly by itself.
    }

    // --- Detail pass --------------------------------------------------------
    // Bumpers, mirrors, sills, door seams, exhaust. None of it is structural;
    // it exists because a car is recognised by its edges and fittings, and
    // without them even a well-proportioned body still reads as a box.
    if (s.id !== 'bike') {
      // (A SECOND set of 1.02x-width bumpers lived here on top of the ones
      // above, plus rocker boxes 8 cm outside the flank and painted-on "door
      // seams". The doors are real now, and the sill follows the body.)
      if (this.bodyShape && !this.usingModel) {
        const shape = this.bodyShape;
        const clr = s.h * s.wheelR + 0.07 + 0.03;
        const sz0 = -s.l * 0.31 + clr, sz1 = s.l * 0.31 - clr;
        if (sz1 - sz0 > 0.4) {
          for (const side of [-1, 1]) {
            const geo = gridPatch(6, 1, (u, v) => {
              const z = sz0 + (sz1 - sz0) * u;
              const sec = shape.section(z, false);
              const y = sec.bottom + 0.012 + sec.rb * 0.85 * v;
              return [side * (shape.flankX(z, y) + 0.006), y, z];
            }, new THREE.Vector3(side, 0, 0));
            const sill = new THREE.Mesh(geo, trim);
            sill.castShadow = true;
            this.group.add(sill);
          }
        }
      }
      // Wing mirrors on stalks.
      //
      // Placed as a FRACTION of width, these scaled with the car: at 0.60 the
      // head sat 23 cm outboard of a sedan's flank, which made the mirrors —
      // not the arches — the widest thing on the vehicle and pushed a stated
      // 1.9 m car out to 2.37 m across. A mirror stands off the body by a
      // roughly fixed amount whatever the car, so it is an offset now, not a
      // ratio. Height comes off the profile shoulder too: at 0.78 they floated
      // halfway up the side glass instead of sitting at the beltline where
      // they bolt on.
      const mirrorY = s.h * (Math.max(...(PROFILES[s.id] || PROFILES.sedan).map((pt) => pt[1])) - 0.02);
      // Mirrors bolt on at the base of the A-pillar, off the real shoulder.
      const [, mc1] = cabinSpan(s);
      const mirrorZ = (mc1 - 0.5) * s.l - 0.10;
      const mirrorX = this.bodyShape ? this.bodyShape.flankX(mirrorZ, mirrorY - 0.02) : s.w * 0.5;
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.1, 0.05, 0.06), trim, side * (mirrorX + 0.04), mirrorY, mirrorZ);
        add(new THREE.BoxGeometry(0.09, 0.11, 0.04), accent, side * (mirrorX + 0.10), mirrorY, mirrorZ);
      }
      // Exhaust tip pointing backwards (it stood upright before), and a grille
      // on the nose rather than hanging 9 cm in front of it.
      const pipe = add(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 10), trim,
        tailHalf * 0.5, s.h * 0.17, -s.l * 0.5 - 0.02);
      pipe.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(noseHalf * 0.95, s.h * 0.09, 0.03), trim, 0,
        onFace(noseTop, 0.36), s.l * 0.5 + 0.015);
    } else {
      // (Engine, pipe and forks are built with the rest of the bike above.)
    }

    // Wheels, kept as handles so they can spin and steer. Axle count comes
    // from the chassis: bikes run one wheel per end on the centreline, trucks
    // and buses get a third axle at the back.
    const wr = s.h * s.wheelR;
    const tyreW = s.id === 'bike' ? 0.16 : 0.28;
    // Tyre gets more segments so the rim reads as round rather than faceted —
    // a 12-sided wheel is the first thing that gives a model away.
    // THE TYRE has shoulders: tread across the top, sidewalls that bulge and
    // roll into the bead. A straight cylinder has none of that and is the
    // first thing that gives a model away.
    const lathe = (pts, segs) => {
      const g = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(r, a)), segs);
      g.rotateZ(-Math.PI / 2);
      return g;
    };
    const rimR = wr * 0.68, hw = tyreW / 2;
    const wheelGeo = lathe([
      [rimR, -hw * 0.86], [rimR + (wr - rimR) * 0.35, -hw * 1.0], [wr - (wr - rimR) * 0.16, -hw * 0.98],
      [wr, -hw * 0.78], [wr, hw * 0.78], [wr - (wr - rimR) * 0.16, hw * 0.98],
      [rimR + (wr - rimR) * 0.35, hw * 1.0], [rimR, hw * 0.86]
    ], 28);
    // THE RIM is a lip and a barrel — open in the middle. It used to be a
    // solid disc with spokes laid flat on it: from the street a white plate
    // on every corner with nothing behind it. Open, you see through the
    // spokes to the dark brake disc and the caliper, which is what makes a
    // wheel read as a wheel.
    const rimGeo = new THREE.TorusGeometry(rimR - 0.012, 0.02, 6, 32);
    rimGeo.rotateY(Math.PI / 2);
    const barrelGeo = new THREE.CylinderGeometry(rimR - 0.03, rimR - 0.03, tyreW * 0.82, 24, 1, true);
    barrelGeo.rotateZ(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
    const hubGeo = lathe([[wr * 0.2, 0], [wr * 0.2, hw * 0.46], [wr * 0.12, hw * 0.6], [0.0, hw * 0.62]], 14);
    // A split spoke: two arms from hub to lip, dished outward at the hub.
    const spokeGeo = (() => {
      const parts = [];
      for (const off of [-0.11, 0.11]) {
        const g = new THREE.BoxGeometry(tyreW * 0.16, (rimR - wr * 0.16) * 1.02, wr * 0.075);
        g.translate(0, wr * 0.16 + (rimR - wr * 0.16) / 2, 0);
        g.rotateX(off);
        g.rotateZ(0);
        parts.push(g);
      }
      return mergeParts(parts);
    })();
    const discGeo = new THREE.CylinderGeometry(wr * 0.58, wr * 0.58, tyreW * 0.14, 14);
    discGeo.rotateZ(Math.PI / 2);
    const discMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.45, metalness: 0.8 });
    const calGeo = new THREE.BoxGeometry(tyreW * 0.3, wr * 0.4, wr * 0.26);
    const calMat = new THREE.MeshStandardMaterial({ color: 0x8a2b22, roughness: 0.6, metalness: 0.3 });
    // WHEELS SIT INSIDE THE BODY, NOT ON ITS EDGE.
    //
    // This was s.w * 0.5, which puts the wheel's CENTRE exactly on the body's
    // outer face — so the entire tyre hung outside the car. A sedan stated as
    // 1.9 m wide rendered 2.37 m across, and the wheels read as bolted to the
    // sides rather than running in arches. Pulling the track in by most of a
    // tyre's width leaves the outer sidewall just inside the flank, which is
    // where it sits on a real car.
    // 0.58 was an overcorrection: it pulled the whole tyre behind the flank,
    // and since the shell is a solid extrusion with no arch cut into it, the
    // wheels simply disappeared inside the bodywork. Flush is what is wanted —
    // the outer sidewall level with the side of the car, a centimetre or two
    // proud, which is where it sits on the real thing and keeps the wheel on
    // the silhouette where you can see it.
    const wx = s.w * 0.5 - tyreW * 0.45;
    // Bikes already have their own wheels from the Motorcycle module.
    if (s.id !== 'bike') this.wheels = [];
    const slots = [];
    if (s.id !== 'bike') {
      slots.push([-1, s.l * 0.31], [1, s.l * 0.31], [-1, -s.l * 0.31], [1, -s.l * 0.31]);
      if (s.axles >= 3) slots.push([-1, -s.l * 0.44], [1, -s.l * 0.44]);
    }
    for (const [sx, wz] of slots) {
      // A wheel is a GROUP now: tyre, rim face, hub cap and five spokes. The
      // rim is what you actually look at on a car, and a bare dark cylinder
      // was throwing away the most recognisable part of the whole vehicle.
      // The outer group steers; the inner one spins. The caliper belongs to
      // the steering group, so it turns with the wheel but does not rotate
      // with it — it used to go round with the spokes.
      const hubGrp = new THREE.Group();
      hubGrp.position.set(sx * wx, wr, wz);
      const spinGrp = new THREE.Group();
      hubGrp.add(spinGrp);
      const tyre = new THREE.Mesh(wheelGeo, trim);
      tyre.castShadow = true;
      // A tyre's bounds (0.36 m) fall under the LOD's 0.45 m "small part"
      // cut, so every car past 80 m was rolling along on no tyres at all.
      tyre.userData.keepLOD = true;
      spinGrp.add(tyre);
      const rim = new THREE.Mesh(rimGeo, chrome);
      rim.position.x = sx * hw * 0.88;
      spinGrp.add(rim);
      spinGrp.add(new THREE.Mesh(barrelGeo, barrelMat));
      const hub = new THREE.Mesh(hubGeo, accent);
      hub.position.x = sx * hw * 0.2;
      hub.scale.x = sx;
      spinGrp.add(hub);
      for (let sp = 0; sp < 5; sp++) {
        const spoke = new THREE.Mesh(spokeGeo, chrome);
        spoke.rotation.x = (sp / 5) * Math.PI * 2;
        spoke.position.x = sx * hw * 0.42;
        spinGrp.add(spoke);
      }
      // Brake disc and caliper, set inboard of the spokes. You only ever see
      // these through the gaps in the rim, which is exactly why they matter —
      // a wheel with nothing behind it reads as a printed disc, and a wheel
      // with something dark and mechanical behind it reads as a wheel.
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.x = sx * tyreW * 0.02;
      spinGrp.add(disc);
      const cal = new THREE.Mesh(calGeo, calMat);
      cal.position.set(sx * tyreW * 0.06, wr * 0.36, -wr * 0.22);
      hubGrp.add(cal);
      this.group.add(hubGrp);
      this.wheels.push({ mesh: hubGrp, spin: spinGrp, front: wz > 0 });
    }

    // --- Wheel wells ---------------------------------------------------------
    // The arches are real openings in the body now, cut by the shell itself.
    // What an opening needs is a DARK INSIDE: look into the arch of any car and
    // you see black plastic liner, not the underside of the paint. Without it
    // the cut-out showed body colour all round the tyre and read as a hole in a
    // cardboard model rather than a wheel well.
    //
    // One half-cylinder per axle spanning the width, open-ended and lit on both
    // faces, sitting just outside the tyre. The old slab "flares" that stood
    // here are gone — they were inventing an arch the body did not have, and
    // against a body that has one they read as fins bolted to the sides.
    if (s.id !== 'bike') {
      const well = new THREE.MeshStandardMaterial({
        color: 0x0b0c0e, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide
      });
      const axleZs = [...new Set(slots.map(([, wz]) => wz))];
      for (const wz of axleZs) {
        const sec = this.bodyShape ? this.bodyShape.section(wz, false) : null;
        const outer = sec ? sec.hwB : s.w * 0.47;
        const inner = (sec ? sec.xw : s.w * 0.3) - 0.02;
        const lenW = Math.max(0.1, outer - inner);
        for (const side of [-1, 1]) {
          // Wraps a little under the axle line at both ends, so you cannot
          // see body colour below the tyre either.
          const geo = new THREE.CylinderGeometry(wr + 0.042, wr + 0.042, lenW, 16, 1, true,
            -0.15 * Math.PI, 1.3 * Math.PI);
          geo.rotateZ(Math.PI / 2);
          add(geo, well, side * (inner + lenW / 2), wr, wz);
        }
      }
      // Front lip and rear valance. These were a 42 cm and a 50 cm slab of
      // black at bumper height, projecting past both ends of the car: from
      // the side they were a long dark plank sticking out of the nose and a
      // wedge hanging off the tail. A real lip is a few centimetres deep.
      add(new THREE.BoxGeometry(s.w * 0.86, 0.05, 0.12), trim, 0, s.h * 0.13, s.l * 0.475);
      add(new THREE.BoxGeometry(s.w * 0.80, 0.08, 0.14), trim, 0, s.h * 0.14, -s.l * 0.47);
      // Side intakes ahead of the rear wheels — the Lamborghini signature.
      if (s.id === 'sport' || s.id === 'muscle' || s.id === 'coupe') {
        for (const side of [-1, 1]) {
          add(new THREE.BoxGeometry(0.06, s.h * 0.16, s.l * 0.14),
            trim, side * s.w * 0.51, s.h * 0.36, -s.l * 0.12);
        }
      }
    }

    // --- Roof fitting: the quickest way to tell two same-chassis cars apart --
    //
    // These are the one family of parts that SHOULD sit above the roof, so
    // they are measured from it: `s.h` is the roofline exactly now, and each
    // fitting is offset by its own half-height so it rests on the panel. They
    // used to be fractions of s.h chosen to clear the old, inflated cabin —
    // with the roof brought down to its stated height they hovered in the air
    // above it.
    const ROOF = s.h;
    if (e.roof === 'rack') {
      // Rails along the roof and four feet down onto it — without them the
      // rack floated a few centimetres over the car.
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(0.05, 0.04, s.l * 0.52), trim, sx * s.w * 0.37, ROOF + 0.02, -s.l * 0.04);
        for (const sz of [-1, 1]) {
          add(new THREE.BoxGeometry(0.07, 0.09, 0.09), trim, sx * s.w * 0.37, ROOF - 0.03, -s.l * 0.04 + sz * s.l * 0.22);
        }
      }
      add(new THREE.BoxGeometry(s.w * 0.8, 0.06, s.l * 0.5), trim, 0, ROOF + 0.06, -s.l * 0.04);
      add(new THREE.BoxGeometry(s.w * 0.7, 0.12, 0.08), trim, 0, ROOF + 0.12, s.l * 0.18);
    } else if (e.roof === 'sign') {
      add(new THREE.BoxGeometry(s.w * 0.42, 0.2, 0.22), lamp, 0, ROOF + 0.10, 0);
    } else if (e.roof === 'wing') {
      add(new THREE.BoxGeometry(s.w * 0.94, 0.06, 0.26), accent, 0, s.h * 0.86, -s.l * 0.48);
      add(new THREE.BoxGeometry(0.06, 0.16, 0.2), trim, -s.w * 0.36, s.h * 0.78, -s.l * 0.48);
      add(new THREE.BoxGeometry(0.06, 0.16, 0.2), trim, s.w * 0.36, s.h * 0.78, -s.l * 0.48);
    } else if (e.roof === 'scoop') {
      add(new THREE.BoxGeometry(s.w * 0.34, 0.12, s.l * 0.16), trim, 0, s.h * 0.68, s.l * 0.22);
    } else if (e.roof === 'stack') {
      add(new THREE.CylinderGeometry(0.09, 0.11, s.h * 0.5, 8), trim, -s.w * 0.42, ROOF + s.h * 0.25, s.l * 0.22);
    } else if (e.roof === 'vent') {
      for (let i = -1; i <= 1; i++) {
        add(new THREE.BoxGeometry(s.w * 0.5, 0.1, 0.4), trim, 0, ROOF + 0.05, i * s.l * 0.24);
      }
    } else if (e.roof === 'bar') {
      add(new THREE.BoxGeometry(s.w * 0.9, 0.1, 0.14), lamp, 0, ROOF + 0.05, s.l * 0.02);
    }

    if (this.isPolice) {
      // Light bar. Kept as handles so it can flash while a chase is live.
      this.beacons = [];
      for (const [dx, hex] of [[-0.42, 0x2244ff], [0.42, 0xff2222]]) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(s.w * 0.34, 0.16, 0.34),
          new THREE.MeshStandardMaterial({ color: 0x101014, emissive: hex, emissiveIntensity: 0.6, roughness: 0.4 })
        );
        b.position.set(dx * s.w * 0.5, s.h + 0.08, -s.l * 0.02);
        this.group.add(b);
        this.beacons.push(b.material);
      }
      // Livery panels.
      const white = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.5, metalness: 0.2 });
      add(new THREE.BoxGeometry(s.w * 1.01, s.h * 0.24, s.l * 0.36), white, 0, s.h * 0.42, s.l * 0.1);
    }

    if (s.id !== 'bike') this._buildInterior(s, e, add, trim, accent, glass);
    this._addOccupants(s, add);

    // Collision radius comes from WIDTH, not length. A capsule approximates
    // the car's cross-section as it travels, so sizing it off the long axis
    // made a 2.1 m-wide pickup collide as a 4.3 m-wide cylinder — wide enough
    // that a car parked correctly in its lane already overlapped the kerb, and
    // any throttle ground it to death against scenery it never touched.
    this.radius = s.w * 0.5;
    this.halfL = s.l * 0.5;
  }

  /**
   * The cabin, from the inside.
   *
   * This exists because the driving view sits at the driver's eye and looks
   * out through the windscreen. From there the car is not a silhouette — it's
   * a dashboard, a wheel rim, door cards either side and a mirror overhead,
   * and every one of those is what tells you you're in a car rather than
   * floating above the road. The steering wheel is kept as a handle so it
   * turns with the front axle.
   */
  _buildInterior(s, e, add, trim, accent, glass) {
    const cabinZ = s.id === 'bus' ? 0 : (s.id === 'truck' ? s.l * 0.26 : -s.l * 0.04);
    const cabinL = s.l * s.cabin;
    const floorY = s.h * 0.60;
    const dashZ = cabinZ + cabinL * 0.42;
    // THE WINDOW LINE. The cabin floor sits only a few centimetres under it
    // (the body below is solid), so anything tall in here stands in the
    // glass. Sized against the floor, the seat backs ran from sill to roof and
    // the door cards rose a quarter-metre up the windows: from the street
    // every car had two black boards standing in its glasshouse. Placed
    // against the belt instead, what shows through the glass is what shows on
    // a real car — the tops of the seats, the headrests, the dash top.
    const beltLine = s.h * Math.max(...(PROFILES[s.id] || PROFILES.sedan).map((pt) => pt[1]));

    // Upholstery varies car to car; near-black everywhere read as a void.
    const TRIMS = [0x2a2b2e, 0x46484d, 0x7c6d58, 0x5e4230, 0x3a3226, 0x55201c];
    const cloth = new THREE.MeshStandardMaterial({
      color: TRIMS[(Math.random() * TRIMS.length) | 0], roughness: 0.88, metalness: 0.02
    });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.72, metalness: 0.08 });
    // Instrument glow, not a light source. At 0.8 these read as bright cyan
    // slabs filling the dash rather than as small backlit displays.
    const dial = new THREE.MeshStandardMaterial({
      color: 0x0a1014, emissive: 0x1c6d86, emissiveIntensity: 0.28, roughness: 0.5
    });

    // Floor pan and bulkhead, so you can't see out through the bottom.
    add(new THREE.BoxGeometry(s.w * 0.86, 0.05, cabinL * 1.1), plastic, 0, floorY, cabinZ);

    // --- Dashboard, binnacle and centre stack -------------------------------
    const dashTop = beltLine + 0.07;
    add(new THREE.BoxGeometry(s.w * 0.86, 0.2, 0.30), plastic, 0, dashTop - 0.1, dashZ);
    // Instrument binnacle in front of the driver (left-hand drive).
    const dx = -s.w * 0.22;
    const gaugeY = dashTop + 0.02;
    add(new THREE.BoxGeometry(0.34, 0.12, 0.22), plastic, dx, gaugeY, dashZ - 0.06);
    add(new THREE.BoxGeometry(0.28, 0.09, 0.02), dial, dx, gaugeY, dashZ - 0.17);
    // Centre stack: screen and vents, set into the dash face.
    add(new THREE.BoxGeometry(0.24, 0.14, 0.03), dial, 0, dashTop - 0.1, dashZ - 0.16);
    for (const vx of [-0.42, 0.42]) {
      add(new THREE.BoxGeometry(0.16, 0.06, 0.03), trim, vx * s.w * 0.5, dashTop - 0.05, dashZ - 0.16);
    }

    // --- Steering wheel: rim, hub and spokes --------------------------------
    this.wheelRig = new THREE.Group();
    // Placed relative to the DRIVER, not to the cabin.
    //
    // Deriving the offset from cabin length meant the framing changed with
    // every chassis: fine in a van, but a sport's short cabin put the rim
    // 14 cm from the eye where it projects off the bottom of the screen. A
    // fixed 42 cm ahead and 14 cm below the eye is a real driving position and
    // frames identically in all ten bodies.
    // Eye sits high in the glazed band and set BACK from the dash. Too low or
    // too far forward and the dashboard eats the road — which is the whole
    // reason to be in here.
    // EYE HEIGHT, MEASURED INSIDE THE CABIN.
    //
    // s.h * 1.01 put the driver's eye ABOVE the roof. That was survivable
    // while the greenhouse overshot the stated height by 10%, and became the
    // reason every car had its dashboard, steering wheel, hands and rear-view
    // mirror standing proud of its own roofline — the dark slab you could see
    // hovering over the cabin was the interior, not the bodywork.
    //
    // Halfway up the glazed band is where a person's eyes actually are.
    const shoulderFrac = Math.max(...(PROFILES[s.id] || PROFILES.sedan).map((pt) => pt[1]));
    const beltY = s.h * shoulderFrac;
    const eyeY = beltY + (s.h - beltY) * 0.5;
    const eyeZ = cabinZ + cabinL * 0.02;
    this.wheelRig.position.set(dx, eyeY - 0.20, eyeZ + 0.52);
    this.wheelRig.rotation.x = -0.42;                 // raked toward the driver
    this.group.add(this.wheelRig);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.019, 8, 22), plastic);
    this.wheelRig.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), accent);
    hub.rotation.x = Math.PI / 2;
    this.wheelRig.add(hub);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.02), plastic);
      spoke.rotation.z = (i / 3) * Math.PI * 2;
      spoke.position.set(Math.cos(spoke.rotation.z) * 0.08, Math.sin(spoke.rotation.z) * 0.08, 0);
      this.wheelRig.add(spoke);
    }

    // --- Hands on the wheel --------------------------------------------------
    // Parented to the rig, so they turn WITH the wheel — which is the whole
    // point. Hands pinned to the dashboard while the rim rotates under them
    // reads as broken immediately; hands that go round with it read as a
    // person driving.
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc08a63, roughness: 0.86 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2f3d52, roughness: 0.9 });
    for (const side of [-1, 1]) {
      // Ten and two on the rim.
      const a = side < 0 ? Math.PI * 0.78 : Math.PI * 0.22;
      const hx = Math.cos(a) * 0.15;
      const hy = Math.sin(a) * 0.15;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.075), skinMat);
      hand.position.set(hx, hy, 0.03);
      hand.rotation.z = a;
      this.wheelRig.add(hand);
      // Thumb hooked over the rim.
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.055, 0.03), skinMat);
      thumb.position.set(hx * 0.86, hy * 0.86, -0.02);
      this.wheelRig.add(thumb);
      // Forearm running back toward the driver, out of the rig so it does not
      // spin with the rim.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.30), sleeveMat);
      arm.position.set(dx + side * 0.16, floorY + s.h * 0.30, dashZ - 0.68);
      arm.rotation.x = 0.34;
      this.group.add(arm);
    }

    // --- Gauge cluster -------------------------------------------------------
    // Rings and needles in the binnacle. At a glance it is the difference
    // between a dashboard and a dark shelf.
    const needleMat = new THREE.MeshStandardMaterial({
      color: 0x2a0d08, emissive: 0xff5533, emissiveIntensity: 1.1, roughness: 0.5
    });
    const bezel = new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.6, metalness: 0.5 });
    this.needles = [];
    for (let gi = 0; gi < 3; gi++) {
      const gx = dx + (gi - 1) * 0.115;
      const rad = gi === 1 ? 0.052 : 0.040;
      const face = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.012, 14), bezel);
      face.rotation.x = Math.PI / 2 - 0.42;
      face.position.set(gx, gaugeY, dashZ - 0.175);
      this.group.add(face);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.007, rad * 1.5, 0.006), needleMat);
      needle.position.set(gx, gaugeY, dashZ - 0.183);
      needle.rotation.x = -0.42;
      this.group.add(needle);
      this.needles.push({ mesh: needle, base: -2.2, span: 4.4, kind: gi });
    }

    // --- Seats: base, back and headrest, both sides -------------------------
    // Everything in here is measured against the headroom actually available,
    // not against fixed centimetres.
    const room = Math.max(0.26, s.h - floorY);
    const seatZ = cabinZ - cabinL * 0.02;
    const backZ = cabinZ - cabinL * 0.22;
    for (const side of [-1, 1]) {
      const sx = side * s.w * 0.22;
      // Seat heights scale with the room between the floor pan and the roof.
      // These were absolute metres — a 0.66 m headrest on a floor that moves
      // with the chassis. In a van that fits; in a coupe whose roof is 0.48 m
      // above the pan it put the headrests a quarter of a metre through the
      // roofline, which is what the dark mass hovering over every cabin was.
      add(new THREE.BoxGeometry(0.42, room * 0.19, 0.44), cloth, sx, floorY + room * 0.12, seatZ);
      const cushTop = floorY + room * 0.215;
      const backTop = Math.min(s.h - 0.2, beltLine + 0.13);
      const bh = Math.max(0.1, backTop - cushTop);
      const back = add(new THREE.CapsuleGeometry(0.05, 0.001, 3, 8).scale(4.2, bh / 0.1, 1), cloth, sx, cushTop + bh / 2, backZ);
      back.rotation.x = -0.12;
      // Headrest, clear of the back, on two posts.
      const hy = Math.min(s.h - 0.1, backTop + 0.11);
      add(new THREE.CapsuleGeometry(0.05, 0.001, 3, 8).scale(2.5, 1.55, 1.1), cloth, sx, hy, backZ - 0.03);
      for (const px of [-0.06, 0.06]) {
        add(new THREE.CylinderGeometry(0.008, 0.008, hy - backTop, 5), trim, sx + px, (hy + backTop) / 2 - 0.03, backZ - 0.02);
      }
    }
    // Rear bench on anything with room for one.
    if (cabinL > 2.0) {
      add(new THREE.BoxGeometry(s.w * 0.74, room * 0.19, 0.40), cloth, 0, floorY + room * 0.12, cabinZ - cabinL * 0.40);
      const cushTop = floorY + room * 0.215;
      const backTop = Math.min(s.h - 0.22, beltLine + 0.11);
      const bh = Math.max(0.1, backTop - cushTop);
      add(new THREE.CapsuleGeometry(0.05, 0.001, 3, 8).scale(s.w * 7.4, bh / 0.1, 1), cloth, 0, cushTop + bh / 2, cabinZ - cabinL * 0.56);
      for (const hx of [-0.32, 0.32]) {
        add(new THREE.CapsuleGeometry(0.05, 0.001, 3, 8).scale(2.3, 1.4, 1.0), cloth, hx * s.w, Math.min(s.h - 0.12, backTop + 0.1), cabinZ - cabinL * 0.56 - 0.02);
      }
    }

    // --- Door cards, handles and a centre console ---------------------------
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.04, 0.24, cabinL * 0.8), plastic, side * s.w * 0.42, beltLine - 0.13, cabinZ);
      add(new THREE.BoxGeometry(0.05, 0.04, 0.14), accent, side * s.w * 0.40, beltLine - 0.06, cabinZ + 0.1);
    }
    add(new THREE.BoxGeometry(0.20, 0.14, cabinL * 0.5), plastic, 0, floorY + 0.09, cabinZ - cabinL * 0.05);
    // Gear lever.
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.18, 6), trim, 0, floorY + 0.22, cabinZ + cabinL * 0.14);
    add(new THREE.SphereGeometry(0.035, 8, 6), accent, 0, floorY + 0.31, cabinZ + cabinL * 0.14);

    // --- Rear-view mirror and sun visors ------------------------------------
    // Hung from the HEADLINING, which is what they are attached to on a real
    // car. Measured up from the floor pan as `floorY + s.h * 0.52` they ended
    // up above the roof on every low-roofed chassis, because the floor already
    // scales with height and the offset piled another half a body height on
    // top of it.
    const liningY = s.h - s.h * 0.075;
    add(new THREE.BoxGeometry(0.26, 0.07, 0.03), plastic, 0, liningY, dashZ - 0.24);
    add(new THREE.BoxGeometry(0.24, 0.055, 0.012), glass, 0, liningY, dashZ - 0.26);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.30, 0.02, 0.14), plastic, side * s.w * 0.2,
        liningY + s.h * 0.02, dashZ - 0.14);
    }

    // Where the driver's head sits — used directly by the cockpit camera, so
    // it has to land in the gap between the dashboard top and the headlining.
    // The dash tops out around 0.88h and the roof panel is at 1.07h; at 1.06h
    // the camera was pressed into the roof and you saw nothing but headlining.
    // 0.97h puts the eye in the middle of the glazed band, looking out.
    this.eye = new THREE.Vector3(dx, eyeY, eyeZ);
  }

  /**
   * Somebody at the wheel.
   *
   * Empty cars sliding around a city is one of those things you don't
   * consciously notice until you look at a screenshot and the place feels
   * abandoned. Only the parts visible through glass are built — head,
   * shoulders, upper arms — because that's all you can ever see, and the
   * driver is hidden entirely once the player takes the seat.
   */
  _addOccupants(s, add) {
    if (s.id === 'bike') return;        // the Motorcycle module seats its own rider
    const SKIN = [0xc08a63, 0x8d5a3b, 0x5f3a24, 0xe0b48c, 0x9a6b48, 0x3f2716];
    const SHIRT = [0x2f3d52, 0x6b3a3a, 0x3f5340, 0x54506a, 0x7a6a4a, 0x2b2b31];
    const skin = new THREE.MeshStandardMaterial({
      color: SKIN[(Math.random() * SKIN.length) | 0], roughness: 0.88
    });
    const shirt = new THREE.MeshStandardMaterial({
      color: SHIRT[(Math.random() * SHIRT.length) | 0], roughness: 0.9
    });

    const cabinZ = s.id === 'bus' ? 0 : (s.id === 'truck' ? s.l * 0.26 : -s.l * 0.04);
    const cabinL = s.l * s.cabin;
    const dx = -s.w * 0.22;

    // FIT THE PERSON TO THE CABIN. Fixed offsets put a 1.62 m head inside a
    // car whose roof is at 1.28 — drivers stood straight up through the
    // bodywork. Everything below is measured from the seat base to the
    // headlining, so a coupe gets someone hunched low and a bus gets someone
    // sitting tall, which is what actually happens.
    // The roof is at s.h exactly now — the greenhouse is built to land there
    // rather than being stacked on top of the body. This used to assume
    // s.h * 1.05, which was true while the cabin overshot, and became a
    // guarantee of heads through the headlining the moment it stopped.
    //
    // Seat base tracks the body's shoulder, since that is where the floor of
    // the glazed section sits.
    const shoulder = Math.max(...(PROFILES[s.id] || PROFILES.sedan).map((pt) => pt[1]));
    const seatBase = s.h * (shoulder - 0.22);
    const roofline = s.h;
    const headY = roofline - 0.17;
    const cabinRoom = Math.max(0.24, headY - seatBase);
    const torsoH = cabinRoom * 0.72;
    const torsoY = seatBase + torsoH * 0.5;
    const headR = Math.min(0.13, cabinRoom * 0.26);

    this.occupants = new THREE.Group();
    this.group.add(this.occupants);
    const put = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.occupants.add(m);
      return m;
    };

    const seatZ = cabinZ - cabinL * 0.06;
    const person = (px) => {
      put(new THREE.BoxGeometry(0.38, torsoH, 0.22), shirt, px, torsoY, seatZ);
      put(new THREE.SphereGeometry(headR, 10, 8), skin, px, headY - headR, seatZ);
      // Upper arms, angled forward toward the wheel.
      for (const side of [-1, 1]) {
        put(new THREE.BoxGeometry(0.1, torsoH * 0.68, 0.11), shirt,
          px + side * 0.21, torsoY + torsoH * 0.06, seatZ + 0.07);
      }
    };
    person(dx);
    if (Math.random() < 0.4 && s.seats !== 1) person(-dx);
  }

  /** Hide the occupants when the player takes the wheel, show them otherwise. */
  setOccupantsVisible(v) {
    if (this.occupants) this.occupants.visible = v;
  }

  /** True while a human is behind the wheel. */
  get playerDriven() { return this.driver === 'player'; }

  syncMesh() {
    this.group.position.copy(this.position);
    // Bikes lean into corners and rest on a side stand; the rig owns their
    // whole orientation.
    if (this.bike) { this.bike.sync(this); return; }
    // Rolled over: the rigid body owns the whole transform.
    if (this.tumbling) { this._syncTumble(); return; }
    // The body is modelled nose-toward +Z (headlights, bonnet, windscreen all
    // at +Z), but a yaw of 0 travels toward -Z. Without this half-turn every
    // vehicle drove backwards: tail lights leading, headlights pointing at
    // where it had been, and the cockpit camera facing the rear screen.
    //
    // Pitch and roll come from the chassis: the ground under the four wheels,
    // plus whatever the springs are doing about braking, cornering and the
    // last landing.
    if (this.chassis && this.chassis.outY !== undefined) {
      this.chassis.apply(this.group, this.yaw);
    } else {
      this.group.rotation.y = this.yaw + Math.PI;
    }
  }

  /**
   * @param throttle -1..1  (negative reverses / brakes)
   * @param steerIn  -1..1
   * @param handbrake boolean
   */
  drive(dt, throttle, steerIn, handbrake = false) {
    const s = this.style;
    // A car on its roof is not driving anywhere. The rigid body has it until
    // it stops moving, and `update` decides what happens then.
    if (this.tumbling) { this.updateTumble(dt); return; }

    // Steering only bites while rolling, and tightens as speed drops — the
    // single biggest thing that stops a car pirouetting on the spot.
    const spd = Math.abs(this.speed);
    const authority = Math.min(1, spd / 7);
    const maxSteer = 0.55 * (1 - Math.min(0.62, spd / s.topSpeed * 0.8));
    this.steer += (steerIn * maxSteer - this.steer) * Math.min(1, dt * 9);

    if (throttle > 0) {
      this.speed += throttle * s.accel * dt;
    } else if (throttle < 0) {
      // Braking is much stronger than reverse acceleration.
      const braking = this.speed > 0.5;
      this.speed += throttle * (braking ? s.accel * 2.1 : s.accel * 0.5) * dt;
    } else {
      this.speed -= Math.sign(this.speed) * Math.min(spd, 5.5 * dt);
    }

    const top = s.topSpeed;
    this.speed = THREE.MathUtils.clamp(this.speed, -top * 0.32, top);

    // Rotate the body. Handbrake cuts grip so the tail steps out.
    const grip = handbrake ? s.grip * 0.35 : s.grip;
    this.yaw -= this.steer * authority * Math.sign(this.speed) * dt * 2.4;

    // Sideways velocity: added by turning, removed by grip.
    this.lateral += this.steer * this.speed * dt * 1.6;
    this.lateral *= Math.pow(1 - grip, dt * 6);

    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _v.copy(_fwd).multiplyScalar(this.speed * dt);
    _v.x += Math.cos(this.yaw) * this.lateral * dt;
    _v.z += -Math.sin(this.yaw) * this.lateral * dt;

    this._move(_v, dt);

    // Wheels: spin with distance travelled, front pair steers.
    this.wheelSpin += this.speed * dt * 2.6;
    for (const wl of this.wheels) {
      (wl.spin || wl.mesh).rotation.x = this.wheelSpin;
      wl.mesh.rotation.y = wl.front ? -this.steer : 0;
    }
    // The steering wheel turns with the axle — several times further, the way
    // a real rack is geared, so small corrections still read from inside.
    if (this.wheelRig) this.wheelRig.rotation.z = -this.steer * 3.4;
    // A bike turns its whole front end about the steering head.
    if (this.bikeSteer) this.bikeSteer.rotation.y = -this.steer * 0.8;
    // Suspension and attitude, before the mesh is pushed at the end.
    if (this.chassis && !this.bike) {
      this.chassis.update(dt, throttle, handbrake);
      // Everything else — the camera, the audio, what the props get shoved by
      // — reads `position`, so the body's real height has to live there too or
      // a jump is a purely cosmetic one.
      this.position.y = this.chassis.y;
    }
    // Needles sweep with speed, so the cluster is alive rather than painted on.
    if (this.needles) {
      const frac = Math.min(1, Math.abs(this.speed) / Math.max(1, this.style.topSpeed));
      for (const n of this.needles) {
        // Middle dial is the rev counter and swings harder than the others.
        const v = n.kind === 1 ? Math.min(1, frac * 1.35) : frac * (0.7 + n.kind * 0.15);
        n.mesh.rotation.z = n.base + v * n.span;
      }
    }
    this.syncMesh();
  }

  /**
   * Distance LOD.
   *
   * A car is 61 meshes and the city holds 130 of them, so vehicles alone were
   * 7,900 of the scene's 10,400 draw calls — three quarters of everything the
   * renderer had to do, whether you were looking at a car or not. It is worst
   * from the air, where the whole city is inside the frustum at once, which is
   * exactly when flying got unplayable.
   *
   * 46 of those 61 meshes have a bounding radius under half a metre: door
   * handles, mirrors, gauge needles, badges, interior trim, the occupants'
   * fingers. At 80 m none of them are more than a pixel. Hiding them costs
   * nothing visually and takes the city's vehicle load from ~7,900 meshes to
   * ~1,900.
   *
   * Toggling `visible` is the right lever here: three.js skips hidden subtrees
   * entirely during render, so this removes the draw call rather than just the
   * pixels.
   */
  _buildLOD() {
    this._lodDetail = [];
    // A rider is most of a motorcycle's silhouette. Hiding the "small" parts
    // at distance took him off the bike and left it riding itself.
    const keep = new Set();
    if (this.bike && this.occupants) this.occupants.traverse((o) => keep.add(o));
    this.group.traverse((o) => {
      if (!o.isMesh || keep.has(o) || o.userData.keepLOD) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const sc = Math.max(o.scale.x, o.scale.y, o.scale.z);
      const r = (o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0) * sc;
      if (r < 0.45) {
        this._lodDetail.push(o);
        o.skipWhenHidden = true;
      }
    });
    this._lodNear = true;
  }

  /**
   * @param dist metres from the camera
   * @param force2 hide the whole vehicle (used past the far cutoff)
   */
  setLOD(dist) {
    if (!this._lodDetail) this._buildLOD();
    // The car you are sitting in always renders in full — you are looking at
    // its interior from six inches away.
    const near = this.driver === 'player' || dist < 80;
    if (near !== this._lodNear) {
      this._lodNear = near;
      for (const m of this._lodDetail) m.visible = near;
    }
    // Past the far cutoff the whole thing goes. 420 m is beyond where a car
    // reads as anything but a coloured speck, and it is the difference
    // between a flyable city and a slideshow.
    const showAll = this.driver === 'player' || dist < 420;
    if (this.group.visible !== showAll) this.group.visible = showAll;
  }

  /** Sweep the car's capsule and absorb whatever it hits. */
  _move(delta, dt) {
    const phys = this.game.physics;
    _prev.copy(this.position);

    // The capsule is swept from a RAISED origin, not from the car's own
    // position. A capsule's extent runs half its height plus its radius below
    // centre — about 1.9 m here — so sweeping from y=0 buries it inside the
    // ground slab. Every frame it resolved out, every frame the pinned y=0 put
    // it back, and the car read as permanently blocked: it never moved, and
    // took collision damage until it exploded on the spot.
    const capHalf = this.style.h * 0.5 + this.radius;
    _probe.set(this.position.x, capHalf + 0.05, this.position.z);

    // moveCapsule integrates position from velocity itself and mutates both in
    // place, so the frame's displacement is handed over as a velocity.
    this._vel.copy(delta).multiplyScalar(1 / Math.max(dt, 1e-5));
    phys.moveCapsule(_probe, this.radius, this.style.h, this._vel, dt, this._res);

    // Only the horizontal result is kept — GTAZ's ground is flat by design.
    this.position.x = _probe.x;
    this.position.z = _probe.z;
    // Street level on the island; down the beach slope past the shore; and a
    // car driven into the sea settles in it rather than riding the seabed.
    this.position.y = this.city && this.city.surfaceAt
      ? Math.max(this.city.surfaceAt(this.position.x, this.position.z), (this.city.seaLevel ?? -0.9) - 1.0)
      : 0;

    // Cars can't swim. Past the beach they bog down hard rather than sailing
    // off across the ocean — the water belongs to the boats.
    const city = this.city;
    if (city && city.isWater && city.isWater(this.position.x, this.position.z)) {
      this.speed *= Math.pow(0.06, dt);
      this.position.x = _prev.x + (this.position.x - _prev.x) * 0.15;
      this.position.z = _prev.z + (this.position.z - _prev.z) * 0.15;
    }

    // How much of the intended move actually happened?
    const wanted = Math.hypot(delta.x, delta.z);
    const got = Math.hypot(this.position.x - _prev.x, this.position.z - _prev.z);
    this._impactCd = Math.max(0, (this._impactCd || 0) - dt);
    if (wanted > 0.02 && got < wanted * 0.55) {
      const impactSpeed = Math.abs(this.speed);
      this.speed *= 0.24;
      this.lateral *= 0.3;
      // Damage once per IMPACT, not once per blocked frame. Holding the
      // throttle against a wall re-triggers the blocked test every frame, so
      // without this a car scraping a building was taking ~30 damage per
      // frame and exploding in well under a second.
      if (impactSpeed > 12 && this._impactCd <= 0) {
        this._impactCd = 0.6;
        this.onCrash(impactSpeed);
      }
    }
  }

  /** True while this vehicle is in a state where rolling it over makes sense. */
  get canTumble() {
    return this.alive && !this.tumbling && !this.bike && !!this.game.freeRoam?.rigid;
  }

  /**
   * Put the car over.
   *
   * Everything up to here is an arcade handling model that cannot represent a
   * vehicle that is not the right way up, so at the moment it goes past the
   * point of no return the car stops being driven and becomes an ordinary
   * rigid body in the same solver as the bins and the crates. It tumbles,
   * slides, hits walls and comes to rest, and only then does the game decide
   * whether it is a car again.
   *
   * @param spin roll rate to leave with; sign picks the direction it goes over
   */
  tumble(spin) {
    if (!this.canTumble) return;
    this.takeDamage(22);
    this._tumbleNow(spin);
    if (this.game.audio && this.game.audio.impact) this.game.audio.impact();
  }

  /**
   * The mechanism, without the gate or the damage.
   *
   * `explode` needs this too, and routing it through `tumble` meant faking
   * `alive` to get past `canTumble` — which let the damage `tumble` deals
   * land on a car whose health was already gone and call `explode` straight
   * back into itself.
   */
  _tumbleNow(spin) {
    if (this.tumbling || this.bike) return;
    const rigid = this.game.freeRoam?.rigid;
    if (!rigid) return;
    const s = this.style;
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const body = new Body({
      half: new THREE.Vector3(s.w * 0.5, s.h * 0.5, s.l * 0.5),
      // Real kerb weights, so a bus does not bounce off a hatchback.
      mass: 1100 * s.mass,
      pos: new THREE.Vector3(this.position.x, this.position.y + s.h * 0.5, this.position.z),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + Math.PI, 0, 'YXZ')),
      restitution: 0.08,
      friction: 0.74,
      drag: 0.2,
      angDrag: 0.45
    });
    body.vel.copy(_fwd).multiplyScalar(this.speed).setY(1.8);
    // Angular velocity is in world space, and a car rolls about its own
    // length — so the axis is the direction it is pointing.
    body.ang.copy(_fwd).multiplyScalar(THREE.MathUtils.clamp(spin, -7, 7));
    // The solver drives the group directly, so a wreck keeps tumbling after
    // the vehicle has stopped being updated by anything else.
    body.mesh = this.group;
    body.offset = new THREE.Vector3(0, -s.h * 0.5, 0);
    rigid.add(body);
    this.tumbleBody = body;
    this.tumbling = true;
    this.speed = 0;
    this.lateral = 0;
    this._rightAt = 0;
  }

  /** Drag the car's group onto wherever the rigid body ended up. */
  _syncTumble() {
    const b = this.tumbleBody;
    if (!b) return;
    this.group.quaternion.copy(b.quat);
    // The body's origin is the centre of the box; the car's own origin is at
    // road level, under the wheels.
    _v.set(0, -this.style.h * 0.5, 0).applyQuaternion(b.quat);
    this.group.position.copy(b.pos).add(_v);
    this.position.copy(this.group.position);
  }

  /**
   * One frame of being upside down.
   *
   * The solver does the moving; this only watches for the car coming to rest
   * and decides what it has come to rest AS. Landed back on its wheels and it
   * is a car again, pointing wherever it ended up. Landed on its roof and it
   * is given a moment, then shoved back over — a vehicle you cannot right is
   * a vehicle that has stranded you, and that is a worse outcome than a
   * slightly generous one.
   */
  updateTumble(dt) {
    const b = this.tumbleBody;
    if (!b) { this.tumbling = false; return; }
    this._syncTumble();
    // Which way is the car's roof pointing?
    _v.set(0, 1, 0).applyQuaternion(b.quat);
    const upright = _v.y > 0.72;
    if (!b.sleeping) { this._rightAt = 0; return; }

    if (upright) {
      // Back on its wheels: hand control back, facing wherever it stopped.
      _v.set(0, 0, 1).applyQuaternion(b.quat);       // local +Z is the nose
      this.yaw = Math.atan2(-_v.x, -_v.z);
      this.position.set(b.pos.x, b.pos.y - this.style.h * 0.5, b.pos.z);
      this.game.freeRoam.rigid.remove(b);
      this.tumbleBody = null;
      this.tumbling = false;
      this.group.quaternion.identity();
      this.group.rotation.order = 'YXZ';
      // The chassis has to forget everything: its last known ground, its
      // springs and its air state all describe a car that no longer exists.
      if (this.chassis) this.chassis = new Chassis(this);
      this.syncMesh();
      return;
    }

    // On its roof. Wait, then flip it.
    this._rightAt += dt;
    if (this._rightAt > 1.6) {
      b.wake();
      _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      _v.crossVectors(_fwd, _UP).normalize();
      b.ang.copy(_fwd).multiplyScalar(_v.y >= 0 ? 4.2 : -4.2);
      b.vel.y = 4.5;
      b.ang.y += (Math.random() - 0.5) * 0.6;
      this._rightAt = -1.2;      // do not immediately try again
    }
  }

  onCrash(speed) {
    const g = this.game;
    // Below 12 the old formula went NEGATIVE and repaired the car: a light
    // police round was healing whatever it hit.
    const dmg = Math.max(0, (speed - 12) * 1.8);
    if (dmg <= 0) return;
    // Whatever you hit shakes — a trunk you plough into rings like one.
    WIND.hit(this.position.x, this.position.z, Math.min(3, speed / 14));
    if (g.audio && g.audio.impact) g.audio.impact();
    if (g.effects && g.effects.burst) {
      g.effects.burst(this.position.clone().setY(1), { count: 8, color: 0xffd9a0, speed: 4, life: 0.35 });
    }
    this.takeDamage(dmg);
  }

  /**
   * The one way a vehicle loses health.
   *
   * Two rules make it impossible to lose a car in a single moment. A capped
   * share of max health per impact — however fast the hit — and a short grace
   * window after each one, so two cars grinding together register one impact
   * rather than sixty a second. Without the window a police car simply
   * touching yours applied its contact damage every frame and the car was
   * gone in three frames; with 7x speeds in FUN it was gone in one.
   */
  /** A landing hard enough to be felt. Called by the chassis. */
  onHardLanding(impact) {
    const g = this.game;
    if (g.audio && g.audio.impact) g.audio.impact();
    // Dust off the tyres, and shake anything loose nearby.
    g.freeRoam?.sandFX?.impact?.(this.position, Math.min(3, impact / 8));
    g.freeRoam?.rigid?.wakeNear(this.position.x, this.position.z, 7);
    // Landings above the threshold cost the car something, scaled the same
    // way a collision is — so a big jump is a decision, not free.
    if (impact > 13) this.takeDamage((impact - 13) * 2.2);
  }

  takeDamage(amount) {
    if (!this.alive || !(amount > 0)) return 0;
    const now = performance.now();
    if (now < (this._hitGrace || 0)) return 0;
    this._hitGrace = now + (this.driver === 'player' ? 350 : 120);
    const dealt = Math.min(amount, (this.maxHealth || 100) * (this.impactCap ?? 0.6));
    this.health -= dealt;
    this._dented = (this._dented || 0) + dealt;
    if (this.health <= 0 && this.alive) this.explode();
    return dealt;
  }

  explode() {
    this.alive = false;
    const g = this.game;
    // The blast thrashes every tree within reach, craters any beach, and
    // throws every loose object around it.
    WIND.hit(this.position.x, this.position.z, 4);
    g.freeRoam?.sandFX?.blast(this.position, 4);
    g.freeRoam?.rigid?.blast(this.position.x, this.position.y + 0.6, this.position.z, 3.2, 14);
    // The car comes apart: panels in its own paint, glass, trim. Real bodies
    // in the same solver, so they bounce off the kerb and lie in the road.
    g.freeRoam?.debris?.burst(this.position, {
      style: this.style,
      color: this.entry?.paint,
      count: Math.round(11 + this.style.mass * 5),
      power: 1
    });
    // And the wreck itself goes over. A car that explodes and stays neatly
    // parked, upright, is the single most obvious tell that nothing in the
    // scene has any weight.
    this._tumbleNow((Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3));
    if (this.tumbleBody) this.tumbleBody.vel.y += 6;
    if (g.effects && g.effects.burst) {
      g.effects.burst(this.position.clone().setY(1.1), { count: 40, color: 0xffa040, speed: 14, life: 0.9 });
    }
    if (g.audio && g.audio.explosion) g.audio.explosion();
    for (const m of this.group.children) if (m.material) m.material.color?.setHex?.(0x14100e);
  }

  /**
   * THE CABIN, AS ONE SHAPE.
   *
   * The greenhouse used to be assembled from boxes: three flat slabs for a
   * roof, a thin stick at each corner for a pillar, and a flat pane leaned
   * into each gap. Seen from the street that is a black box with vertical
   * sides and a lid, sitting on a car — and it was the single most "not a
   * real car" thing left once the body itself was fixed.
   *
   * Here the cabin is a surface. Along the length its top rises from the belt
   * up the windscreen, runs along the roof and comes back down the rear
   * window, all in one curve, so the roofline flows the way a car's does.
   * Across the width the sides lean in from the shoulder to a narrower,
   * crowned roof. The outermost strip of the windscreen and rear-window slopes
   * is painted body colour, which is exactly what A- and C-pillars are.
   *
   * The side windows are sampled from the same surface, so they are
   * trapezoids that follow the roofline down at each end and sit flush with
   * it — and the door windows are cut from it too, which is how they can
   * swing out with the doors without leaving a mismatched gap.
   *
   * Glass is single-sided on purpose: from inside the car you look straight
   * out through it, and from outside it is the dark reflective panel real car
   * glass is. The roof gets a dark headliner on its underside so the sky does
   * not show through it from the driver's seat.
   */
  _buildCanopy(ctx) {
    const s = this.style;
    const shape = this.bodyShape;
    const { body, trim, chrome, glass, windscreen, cabinZ, cabinL, beltY, doorCount } = ctx;
    const hard = ['van', 'truck', 'bus', 'pickup'].includes(s.id);
    const zc0 = cabinZ - cabinL / 2;
    const zc1 = cabinZ + cabinL / 2;
    const L = zc1 - zc0;
    const crown = hard ? 0.012 : Math.min(0.05, s.h * 0.035);
    const gh = Math.max(0.12, s.h - beltY - crown);
    const RAKE_F = { bus: 0.22, truck: 0.35, van: 0.85, suv: 1.15, pickup: 1.15 };
    const RAKE_R = { bus: 0.08, truck: 0.1, van: 0.12, suv: 0.45, pickup: 0.25 };
    const runF = Math.min(L * 0.32, gh * (RAKE_F[s.id] ?? 1.45));
    const runR = Math.min(L * 0.26, gh * (RAKE_R[s.id] ?? 1.1));
    const topRatio = hard ? 0.9 : 0.8;
    // Ease-out, so the glass is steep near its base and rolls into the roof.
    const ease = (t) => { const c = Math.min(1, Math.max(0, t)); return c * (2 - c); };
    const riseAt = (z) => {
      const u = z - zc0;
      if (u <= runR) return ease(u / runR);
      if (u >= L - runF) return ease((L - u) / runF);
      return 1;
    };
    const clampZ = (z) => Math.min(zc1, Math.max(zc0, z));
    const beltX = (z) => shape.flankX(clampZ(z), beltY - 0.015) - 0.004;
    const edgeY = (z) => beltY + gh * riseAt(clampZ(z));
    const topX = (z) => beltX(z) * (1 - (1 - topRatio) * riseAt(clampZ(z)));
    const sideX = (z, y) => {
      const top = edgeY(z);
      const k = top - beltY < 1e-4 ? 0 : Math.min(1, Math.max(0, (y - beltY) / (top - beltY)));
      return beltX(z) + (topX(z) - beltX(z)) * k;
    };
    const topY = (z, x) => {
      const hx = topX(z);
      const q = hx > 0 ? Math.min(1, Math.abs(x) / hx) : 1;
      return edgeY(z) + crown * riseAt(clampZ(z)) * (1 - q * q);
    };

    // --- Top surface: rear window, roof, windscreen ------------------------
    const zs = [];
    for (let i = 0; i <= 6; i++) zs.push(zc0 + runR * (i / 6));
    for (let i = 1; i < 4; i++) zs.push(zc0 + runR + (L - runR - runF) * (i / 4));
    for (let i = 0; i <= 7; i++) zs.push(zc1 - runF + runF * (i / 7));
    zs.sort((a, b) => a - b);
    const Z = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.004);
    const XS = [-1, -0.9, -0.68, -0.36, 0, 0.36, 0.68, 0.9, 1];
    const W = XS.length;
    const pos = [];
    for (const z of Z) {
      const hx = topX(z);
      for (const f of XS) {
        const x = f * hx;
        pos.push(x, topY(z, x), z);
      }
    }
    const roofIdx = [], frontIdx = [], rearIdx = [], liningIdx = [];
    for (let i = 0; i < Z.length - 1; i++) {
      const zm = (Z[i] + Z[i + 1]) / 2;
      const zone = zm < zc0 + runR ? 'rear' : (zm > zc1 - runF ? 'front' : 'roof');
      for (let j = 0; j < W - 1; j++) {
        const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
        const tri = [a, c, b, b, c, d];                    // faces up and out
        const pillar = zone !== 'roof' && (j === 0 || j === W - 2);
        if (zone === 'roof' || pillar) {
          roofIdx.push(...tri);
          liningIdx.push(a, b, c, b, d, c);               // the underside
        } else if (zone === 'front') frontIdx.push(...tri);
        else rearIdx.push(...tri);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex([...roofIdx, ...frontIdx, ...rearIdx]);
    geo.addGroup(0, roofIdx.length, 0);
    geo.addGroup(roofIdx.length, frontIdx.length, 1);
    geo.addGroup(roofIdx.length + frontIdx.length, rearIdx.length, 2);
    geo.computeVertexNormals();
    const canopy = new THREE.Mesh(geo, [body, windscreen, glass]);
    canopy.castShadow = true;
    this.group.add(canopy);

    const liningGeo = new THREE.BufferGeometry();
    const lpos = pos.slice();
    for (let k = 1; k < lpos.length; k += 3) lpos[k] -= 0.025;
    liningGeo.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
    liningGeo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((lpos.length / 3) * 2), 2));
    liningGeo.setIndex(liningIdx);
    liningGeo.computeVertexNormals();
    const lining = new THREE.Mesh(liningGeo, trim);
    this.group.add(lining);

    // --- Chrome line along the belt ----------------------------------------
    for (const side of [-1, 1]) {
      const strip = gridPatch(10, 1, (u, v) => {
        const z = zc0 + L * u;
        const y = beltY - 0.014 + 0.026 * v;
        return [side * (beltX(z) + 0.008), y, z];
      }, new THREE.Vector3(side, 0, 0));
      const m = new THREE.Mesh(strip, chrome);
      this.group.add(m);
    }

    const glaze = { zc0, zc1, beltY, sideX, edgeY, hard };

    // A strip of the cabin side, from z0 to z1, in the given material.
    glaze.sidePatch = (side, z0, z1, off = 0.002) => {
      const cols = Math.max(2, Math.round((z1 - z0) / 0.22));
      return gridPatch(cols, 3, (u, v) => {
        const z = z0 + (z1 - z0) * u;
        const y = beltY + (edgeY(z) - beltY) * v;
        return [side * (sideX(z, y) + off), y, z];
      }, new THREE.Vector3(side, 0, 0));
    };

    // Door-less bodies get fixed side glass all the way along.
    if (!doorCount) {
      for (const side of [-1, 1]) {
        this.group.add(new THREE.Mesh(glaze.sidePatch(side, zc0, zc1), glass));
      }
    }
    return glaze;
  }

  /**
   * DOORS AND BONNET.
   *
   * Every opening panel exists twice. The real one is a pivot group that can
   * swing; a baked copy at the closed pose sits in a small static batch. Closed
   * — which is nearly every car, nearly all the time — the pivots are hidden
   * and the batch draws in three calls. The moment a panel needs to move, the
   * batch hides and the pivots show; once everything is shut again it folds
   * back. Two hundred and fifty cars with four live doors each would cost a
   * thousand extra draw calls for animation almost none of them are doing.
   *
   * Each door is three layers on the body's own curvature: a near-black
   * aperture fixed to the body, a touch larger than the door, whose exposed rim
   * is the shut line; the door skin just proud of that; and a trim card on the
   * inside you only see with it open. The handle and the door's window ride
   * with the skin.
   */
  _buildPanels(ctx) {
    const s = this.style;
    const shape = this.bodyShape;
    if (!shape) return;
    const { body, trim, chrome, glass, glaze, doorCount } = ctx;
    const wantsBonnet = !!this._bayZ;
    if (!doorCount && !wantsBonnet) return;

    const shut = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.92, metalness: 0.05 });
    const card = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.85, metalness: 0.05 });
    const staticParts = new Map();
    const pushStatic = (geo, mat) => {
      if (!staticParts.has(mat)) staticParts.set(mat, []);
      staticParts.get(mat).push(geo);
    };
    const fixed = (geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    const makePanel = (pivotPos, parts, axis, sign, max) => {
      const pivot = new THREE.Group();
      pivot.position.copy(pivotPos);
      for (const { geo, mat, pos, rot } of parts) {
        const m = new THREE.Mesh(geo, mat);
        if (pos) m.position.copy(pos);
        if (rot) m.rotation.copy(rot);
        m.castShadow = true;
        pivot.add(m);
        m.updateMatrix();
        const baked = geo.clone();
        baked.applyMatrix4(m.matrix);
        baked.translate(pivotPos.x, pivotPos.y, pivotPos.z);
        pushStatic(baked, mat);
      }
      pivot.visible = false;
      this.group.add(pivot);
      const panel = { pivot, axis, sign, max, amt: 0, target: 0, hold: 0 };
      this.panels.push(panel);
      return panel;
    };

    const wr = s.h * s.wheelR;
    const archClear = wr + 0.07 + 0.05;
    const [c0, c1] = cabinSpan(s);
    const zc0 = (c0 - 0.5) * s.l;
    const zc1 = (c1 - 0.5) * s.l;

    // --- Doors -------------------------------------------------------------
    if (doorCount) {
      const zHinge = Math.min(zc1, s.l * 0.31 - archClear) - 0.01;
      const zLimit = Math.max(zc0 + 0.05, -s.l * 0.31 + archClear);
      const span = zHinge - zLimit;
      if (span > 0.6) {
        const layout = [];
        if (doorCount >= 4) {
          const fl = Math.min(1.08, span * 0.53);
          layout.push([zHinge, zHinge - fl]);
          layout.push([zHinge - fl - 0.014, zLimit]);
        } else {
          layout.push([zHinge, zHinge - Math.min(1.28, span * 0.84)]);
        }
        let lastRear = zHinge;
        for (const side of [-1, 1]) {            // -1 is the driver's side
          for (let d = 0; d < layout.length; d++) {
            const [zf, zb] = layout[d];
            lastRear = Math.min(lastRear, zb);
            const sec = shape.section((zf + zb) / 2, false);
            const yLo = sec.bottom + sec.rb + 0.035;
            const yHi = sec.peak - 0.018;
            const flank = (z, y, off) => side * (shape.flankX(z, y) + off);
            const out = new THREE.Vector3(side, 0, 0);

            fixed(gridPatch(4, 4, (u, v) => {
              const z = zb - 0.016 + (zf - zb + 0.032) * u;
              const y = yLo - 0.016 + (yHi - yLo + 0.02) * v;
              return [flank(z, y, 0.004), y, z];
            }, out), shut);

            const yMid = (yLo + yHi) / 2;
            const px = flank(zf, yMid, 0.012);
            const pivotPos = new THREE.Vector3(px, 0, zf);
            const parts = [
              {
                geo: gridPatch(5, 5, (u, v) => {
                  const z = zb + (zf - zb) * u;
                  const y = yLo + (yHi - yLo) * v;
                  return [flank(z, y, 0.012) - px, y, z - zf];
                }, out),
                mat: body
              },
              {
                geo: gridPatch(3, 3, (u, v) => {
                  const z = zb + 0.02 + (zf - zb - 0.04) * u;
                  const y = yLo + 0.02 + (yHi - yLo - 0.04) * v;
                  return [flank(z, y, -0.03) - px, y, z - zf];
                }, new THREE.Vector3(-side, 0, 0)),
                mat: card
              }
            ];
            const zh = zb + Math.min(0.2, (zf - zb) * 0.22);
            const yh = yHi - (yHi - yLo) * 0.2;
            parts.push({
              geo: new THREE.BoxGeometry(0.028, 0.034, 0.17), mat: chrome,
              pos: new THREE.Vector3(flank(zh, yh, 0.026) - px, yh, zh - zf)
            });
            // The window is cut from the canopy's own side surface, so it
            // follows the roofline and sits flush when the door is shut.
            const gz0 = Math.max(zb, glaze.zc0) + 0.018;
            const gz1 = Math.min(zf, glaze.zc1) - 0.018;
            if (gz1 - gz0 > 0.12) {
              const win = glaze.sidePatch(side, gz0, gz1, 0.004);
              win.translate(-px, 0, -zf);
              parts.push({ geo: win, mat: glass });
            }
            const panel = makePanel(pivotPos, parts, 'y', side < 0 ? 1 : -1, d === 0 ? 1.1 : 1.0);
            panel.kind = 'door';
          }
        }
        // The cabin side the doors don't cover. Behind the last door a
        // saloon, SUV, pickup or van has a solid C-pillar panel; a coupe has
        // a quarter window. In front of the first door is the A-pillar base.
        const solidRear = ['sedan', 'suv', 'pickup', 'van'].includes(s.id);
        for (const side of [-1, 1]) {
          const q0 = glaze.zc0;
          const q1 = Math.min(glaze.zc1, lastRear) - 0.004;
          if (q1 - q0 > 0.03) fixed(glaze.sidePatch(side, q0, q1), solidRear ? body : glass);
          const a0 = Math.max(glaze.zc0, zHinge) + 0.004;
          if (glaze.zc1 - a0 > 0.03) fixed(glaze.sidePatch(side, a0, glaze.zc1), body);
          // Black B-pillar between front and rear doors.
          if (layout.length > 1) {
            const zB = layout[0][1];
            fixed(glaze.sidePatch(side, zB - 0.045, zB + 0.03, 0.007), trim);
          }
        }
      }
    }

    // --- Bonnet --------------------------------------------------------------
    if (wantsBonnet) {
      const [zB0, zB1raw] = this._bayZ;
      const zB1 = zB1raw + 0.07;
      if (zB1 - zB0 > 0.45) {
        const xbAt = (z) => shape.section(z, false).cornerX * 0.955;
        const hingeY = shape.topAt(zB0, 0) + 0.014;
        const pivotPos = new THREE.Vector3(0, hingeY, zB0);
        const up = new THREE.Vector3(0, 1, 0);
        const lid = gridPatch(6, 8, (u, v) => {
          const z = zB0 + (zB1 - zB0) * v;
          const x = (u * 2 - 1) * xbAt(z);
          return [x, shape.topAt(z, x) + 0.014 - hingeY, z - zB0];
        }, up);
        const underside = gridPatch(4, 5, (u, v) => {
          const z = zB0 + 0.03 + (zB1 - zB0 - 0.06) * v;
          const x = (u * 2 - 1) * xbAt(z) * 0.94;
          return [x, shape.topAt(z, x) - 0.02 - hingeY, z - zB0];
        }, new THREE.Vector3(0, -1, 0));
        this.bonnet = makePanel(pivotPos, [{ geo: lid, mat: body }, { geo: underside, mat: card }], 'x', -1, 0.95);
        this.bonnet.kind = 'bonnet';

        // Shut lines round the lid: a thin dark frame lying on the body, so
        // there is still an open bay to look into with the lid up.
        const strip = (fn) => fixed(gridPatch(8, 1, fn, up), shut);
        strip((u, v) => {
          const x = (u * 2 - 1) * (xbAt(zB0) + 0.02);
          const z = zB0 - 0.02 + 0.018 * v;
          return [x, shape.topAt(z, x) + 0.007, z];
        });
        strip((u, v) => {
          const x = (u * 2 - 1) * (xbAt(zB1) + 0.02);
          const z = zB1 + 0.004 + 0.018 * v;
          return [x, shape.topAt(z, x) + 0.007, z];
        });
        for (const side of [-1, 1]) {
          strip((u, v) => {
            const z = zB0 - 0.02 + (zB1 - zB0 + 0.04) * u;
            const x = side * (xbAt(z) + 0.004 + 0.02 * v);
            return [x, shape.topAt(z, x) + 0.007, z];
          });
        }
      }
    }

    for (const [mat, list] of staticParts) {
      const merged = mergeParts(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.panelStatic.push(mesh);
    }
  }

  /**
   * The engine, built the first time somebody lifts the bonnet. Almost nobody
   * looks under the bonnet of almost any car, so there is no reason to spend
   * the geometry on the other 254 of them up front.
   */
  _buildEngine() {
    if (this.engineGroup || !this._bayZ || !this.bodyShape) return;
    const s = this.style;
    const shape = this.bodyShape;
    const [zBay0, zBay1] = this._bayZ;
    const zA = zBay0 + 0.08;
    const zB = zBay1 - 0.05;
    const L = zB - zA;
    if (L < 0.35) return;
    const zMid = (zA + zB) / 2;
    const floor = shape.bayAt(zMid).floor;
    const half = Math.max(0.2, shape.bayAt(zMid).inner * 0.94);

    const mats = {
      metal: new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 0.5, metalness: 0.75 }),
      black: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.8, metalness: 0.15 }),
      alloy: new THREE.MeshStandardMaterial({ color: 0xa3a9b0, roughness: 0.32, metalness: 0.9 }),
      cover: new THREE.MeshStandardMaterial({ color: this.entry.trim ?? 0x8a1c14, roughness: 0.42, metalness: 0.55 }),
      fluid: new THREE.MeshStandardMaterial({ color: 0xd6dad4, roughness: 0.6, metalness: 0.0 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe2b21c, roughness: 0.5 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb42018, roughness: 0.5 })
    };
    const byMat = new Map();
    const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.updateMatrix();
      geo.applyMatrix4(m.matrix);
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(geo);
    };

    // Block, sump and a pair of ribbed cam covers.
    const blockW = Math.min(half * 1.15, 0.74);
    const blockH = 0.25;
    const blockL = Math.min(L * 0.5, 0.78);
    const blockZ = zA + L * 0.42;
    // Sits low enough that the intake clears the lid's underside as it closes.
    const blockY = floor + 0.05 + blockH / 2;
    put(new THREE.BoxGeometry(blockW, blockH, blockL), mats.metal, 0, blockY, blockZ);
    put(new THREE.BoxGeometry(blockW * 0.78, 0.09, blockL * 0.8), mats.black, 0, floor + 0.06, blockZ);
    const coverY = blockY + blockH / 2 + 0.04;
    for (const sx of [-1, 1]) {
      put(new THREE.BoxGeometry(blockW * 0.36, 0.08, blockL * 0.96), mats.cover, sx * blockW * 0.24, coverY, blockZ);
      for (let r = 0; r < 5; r++) {
        put(new THREE.BoxGeometry(blockW * 0.3, 0.012, 0.018), mats.alloy,
          sx * blockW * 0.24, coverY + 0.046, blockZ - blockL * 0.4 + r * blockL * 0.2);
      }
    }
    // Intake plenum down the middle with runners into each head.
    put(new THREE.BoxGeometry(blockW * 0.2, 0.09, blockL * 0.82), mats.alloy, 0, coverY + 0.07, blockZ);
    for (let r = 0; r < 4; r++) {
      for (const sx of [-1, 1]) {
        put(new THREE.CylinderGeometry(0.019, 0.019, blockW * 0.2, 8), mats.alloy,
          sx * blockW * 0.12, coverY + 0.05, blockZ - blockL * 0.3 + r * blockL * 0.2, 0, 0, Math.PI / 2);
      }
    }
    put(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12), mats.yellow, blockW * 0.24, coverY + 0.055, blockZ + blockL * 0.32);
    // Belt drive on the front of the block.
    put(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), mats.black, -blockW * 0.18, blockY, blockZ + blockL / 2 + 0.02, Math.PI / 2);
    put(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), mats.alloy, blockW * 0.2, blockY + 0.07, blockZ + blockL / 2 + 0.02, Math.PI / 2);
    put(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 14), mats.alloy, blockW * 0.02, blockY - 0.08, blockZ + blockL / 2 + 0.02, Math.PI / 2);
    // Radiator across the front, finned, with a fan behind it.
    const radW = Math.min(half * 1.7, s.w * 0.62);
    put(new THREE.BoxGeometry(radW, 0.30, 0.05), mats.black, 0, floor + 0.25, zB);
    for (let f = 0; f < 8; f++) {
      put(new THREE.BoxGeometry(radW * 0.96, 0.006, 0.056), mats.metal, 0, floor + 0.12 + f * 0.037, zB);
    }
    put(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 18), mats.black, 0, floor + 0.25, zB - 0.06, Math.PI / 2);
    // Top hose from the radiator to the block.
    const hoseLen = Math.max(0.05, (zB - 0.06) - (blockZ + blockL / 2));
    put(new THREE.CylinderGeometry(0.025, 0.025, hoseLen, 8), mats.black,
      blockW * 0.3, floor + 0.34, blockZ + blockL / 2 + hoseLen / 2, Math.PI / 2);
    // Air box and intake pipe, front left.
    put(new THREE.BoxGeometry(0.26, 0.14, 0.28), mats.black, -half * 0.62, floor + 0.28, zB - L * 0.24);
    put(new THREE.CylinderGeometry(0.045, 0.045, half * 0.5, 10), mats.black,
      -half * 0.34, floor + 0.34, zB - L * 0.24, 0, 0, Math.PI / 2);
    // Battery, rear right, with its terminals.
    put(new THREE.BoxGeometry(0.22, 0.18, 0.16), mats.black, half * 0.58, floor + 0.20, zA + 0.13);
    put(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), mats.red, half * 0.58 - 0.06, floor + 0.305, zA + 0.13);
    put(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), mats.black, half * 0.58 + 0.06, floor + 0.305, zA + 0.13);
    // Coolant and brake reservoirs.
    put(new THREE.BoxGeometry(0.12, 0.14, 0.16), mats.fluid, half * 0.66, floor + 0.24, zB - L * 0.22);
    put(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), mats.yellow, half * 0.66, floor + 0.325, zB - L * 0.22);
    put(new THREE.BoxGeometry(0.10, 0.10, 0.10), mats.fluid, -half * 0.6, floor + 0.20, zA + 0.12);
    // Strut towers either side, painted like the body.
    const paint = this.group.children.find((c) => c.isMesh && c.material && c.material.clearcoat === 1 && !c.material.transparent)?.material || mats.metal;
    for (const sx of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.08, 0.10, 0.24, 14), paint, sx * half * 0.92, floor + 0.28, zA + L * 0.3);
    }
    // Firewall insulation.
    put(new THREE.BoxGeometry(half * 1.9, 0.22, 0.025), mats.black, 0, floor + 0.2, zA - 0.05);

    const grp = new THREE.Group();
    for (const [mat, list] of byMat) {
      const merged = mergeParts(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      grp.add(mesh);
    }
    grp.visible = false;
    this.group.add(grp);
    this.engineGroup = grp;
  }

  /** Door 0 is the driver's. Opens it and leaves it open. */
  setDoor(i, open) {
    const p = this.panels.filter((q) => q.kind === 'door')[i];
    if (!p) return;
    p.target = open ? 1 : 0;
    p.hold = 0;
    this._wakePanels();
  }

  /** Open a door and swing it shut again after `hold` seconds fully open. */
  flashDoor(i, hold = 0.5) {
    const p = this.panels.filter((q) => q.kind === 'door')[i];
    if (!p) return;
    p.target = 1;
    p.hold = hold;
    this._wakePanels();
  }

  setBonnet(open) {
    if (!this.bonnet) return;
    if (open) this._buildEngine();
    this.bonnet.target = open ? 1 : 0;
    this.bonnet.hold = 0;
    this.bonnetOpen = !!open;
    this._wakePanels();
  }

  _wakePanels() {
    if (!this.panels.length) return;
    if (!this._panelsLive) {
      this._panelsLive = true;
      for (const m of this.panelStatic) m.visible = false;
      for (const p of this.panels) p.pivot.visible = true;
    }
    if (this.engineGroup && this.bonnet && this.bonnet.target > 0) this.engineGroup.visible = true;
    _animatingPanels.add(this);
  }

  tickPanels(dt) {
    let busy = false;
    for (const p of this.panels) {
      if (p.hold > 0 && p.amt >= 1) {
        p.hold -= dt;
        if (p.hold <= 0) { p.hold = 0; p.target = 0; }
      }
      const rate = p.target > p.amt ? 2.8 : 2.2;
      const gap = p.target - p.amt;
      p.amt += Math.sign(gap) * Math.min(Math.abs(gap), dt * rate);
      // Eased so the panel starts and stops like something with mass.
      const e = p.amt * p.amt * (3 - 2 * p.amt);
      if (p.axis === 'y') p.pivot.rotation.y = p.sign * e * p.max;
      else p.pivot.rotation.x = p.sign * e * p.max;
      if (p.amt !== p.target || p.hold > 0) busy = true;
    }
    if (busy) return;
    _animatingPanels.delete(this);
    if (this.panels.every((p) => p.amt === 0)) {
      this._panelsLive = false;
      for (const m of this.panelStatic) m.visible = true;
      for (const p of this.panels) p.pivot.visible = false;
      if (this.engineGroup) this.engineGroup.visible = false;
    }
  }

  dispose() {
    _animatingPanels.delete(this);
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}


/** Merge geometries that already share a material. Position/normal/uv only. */
function mergeParts(geos) {
  if (!geos.length) return null;
  let vtx = 0;
  for (const g of geos) vtx += g.attributes.position.count;
  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const uv = new Float32Array(vtx * 2);
  const idx = [];
  let vo = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    pos.set(p.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + vo);
    else for (let i = 0; i < p.count; i++) idx.push(i + vo);
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export { CHASSIS, CATALOG };
