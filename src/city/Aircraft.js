import * as THREE from 'three';
import {
  loft, ellipseRing, wingGeometry, surfaceGeometry, tube, aimMesh, span,
  mergeGeos, gridPatch, bladeDiscTexture
} from './Shape.js';
import { WIND } from '../world/Wind.js';

/**
 * Aircraft — the machines parked at CROSSWIND FIELD.
 *
 * THE FLIGHT MODEL keeps the one rule that makes flying feel like flying:
 * LIFT COMES FROM AIRSPEED. You cannot rotate off the tarmac until you're
 * moving fast enough, and if you haul the nose up too steeply the speed
 * bleeds away and you sink. Without that coupling, takeoff is a jump button
 * and the runway may as well not exist.
 *
 * THE AIRFRAMES used to be a lathe with boxes bolted to it — a plank for a
 * wing, a plank for the fin, a plank spinning on the nose for a propeller.
 * An aircraft is read almost entirely from two shapes: the aerofoil section
 * of its flying surfaces and the continuous taper of its fuselage. Both are
 * lofts, so both are built as lofts now (see Shape.js):
 *
 *   - the fuselage is a superellipse ring swept nose to tail, so the body has
 *     a real waistline and a highlight that runs its whole length;
 *   - every wing, fin and stabiliser is a NACA section with taper, sweep,
 *     dihedral and washout;
 *   - ailerons, flaps, elevators and the rudder are separate hinged surfaces
 *     that actually deflect when you move the controls;
 *   - propellers and rotors are twisted blades that fade into a blur disc as
 *     they spin up, because that is what the eye expects of anything turning
 *     faster than it can follow;
 *   - the gear comes up after takeoff and goes down for the approach.
 *
 * All of it is generic. No airframe here is modelled on a particular real
 * aircraft, and nothing carries a manufacturer's marks.
 */

const TYPES = {
  prop: {
    id: 'prop', name: 'SKYHOPPER',
    l: 8.4, w: 11.0, h: 2.9,
    topSpeed: 74, accel: 13, rotateSpeed: 26,   // m/s needed before it will fly
    pitchRate: 0.85, rollRate: 1.5, drag: 0.22,
    retracts: false
  },
  jet: {
    id: 'jet', name: 'VALKYRIE J2',
    l: 12.0, w: 9.0, h: 3.2,
    topSpeed: 128, accel: 26, rotateSpeed: 42,
    pitchRate: 1.05, rollRate: 2.4, drag: 0.16,
    retracts: true
  },
  heli: {
    id: 'heli', name: 'DUSTOFF',
    l: 9.5, w: 2.6, h: 3.4,
    topSpeed: 58, accel: 15, rotateSpeed: 0,    // rises without a roll
    pitchRate: 0.7, rollRate: 1.6, drag: 0.5,
    retracts: false
  }
};

/** Livery accents. Muted airline blues, reds and greens — nobody's scheme. */
const LIVERY = [0x1e4f96, 0x8e2230, 0x1f6b52, 0xb06a18, 0x2b3550, 0x3b4a5e];

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let _discTex = null;

/** The soft disc a spinning blade leaves behind, built once for the city. */
function discTexture() {
  if (!_discTex) _discTex = bladeDiscTexture();
  return _discTex;
}

/** A tail registration, drawn once per aircraft. */
function regTexture(code, ink) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#00000000';
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = '#' + ink.toString(16).padStart(6, '0');
  g.font = 'bold 54px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(code, 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Aircraft {
  constructor(city, x, z, typeId = 'prop', yaw = 0) {
    this.city = city;
    this.game = city.game;
    this.type = { ...(TYPES[typeId] || TYPES.prop) };
    this.style = this.type;                 // FreeRoam reads .style.id/.name
    this.name = this.type.name;

    this.position = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vertical = 0;
    this.driver = null;
    this.alive = true;
    this.health = 160;
    this.maxHealth = 160;
    this.airborne = false;
    this.isAircraft = true;
    this.radius = 3.2;

    // Control-surface deflection, smoothed so the surfaces lead the aircraft
    // rather than snapping to the keyboard.
    this.ctl = { aileron: 0, elevator: 0, rudder: 0, flap: 0 };
    this.gearT = 1;          // 1 down and locked, 0 fully retracted
    this.rpm = 0;            // 0..1, drives blade blur
    this._t = Math.random() * 10;

    this.group = new THREE.Group();
    this._statics = new Map();   // material -> [geometry], merged at the end
    this._build();
    this._flushStatics();
    this.game.scene.add(this.group);
    this.sync();
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Queue a geometry to be merged into one mesh per material.
   *
   * A detailed airframe is a hundred small parts, and a hundred draw calls per
   * aircraft is how you lose a frame budget to six parked aeroplanes. Anything
   * that never moves goes through here; only the surfaces that actually
   * deflect, spin or retract stay as their own meshes.
   */
  _st(geo, mat) {
    if (!geo) return;
    if (!this._statics.has(mat)) this._statics.set(mat, []);
    this._statics.get(mat).push(geo);
  }

  _flushStatics() {
    for (const [mat, geos] of this._statics) {
      const merged = mergeGeos(geos);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      for (const g of geos) if (g !== merged) g.dispose();
    }
    this._statics.clear();
  }

  /** A box/cylinder placed and rotated, queued as static. */
  _put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    geo = geo.clone();
    if (rx || ry || rz) {
      const e = new THREE.Euler(rx, ry, rz);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
    }
    geo.translate(x, y, z);
    this._st(geo, mat);
    return geo;
  }

  /** A strut between two points, queued as static. */
  _strut(a, b, r, mat, segs = 6) {
    const L = span(a, b);
    const g = new THREE.CylinderGeometry(r, r, L, segs);
    const m = new THREE.Mesh(g);
    aimMesh(m, a, b);
    m.updateMatrix();
    g.applyMatrix4(m.matrix);
    this._st(g, mat);
  }

  /**
   * A point on the fuselage skin, so windows, doors, stripes and fairings can
   * lie ON the body instead of hovering a hand's width off it. `theta` is
   * measured from straight up, positive toward +X.
   */
  _skin(z, theta, out = 0) {
    const S = this._sections;
    let i = 0;
    while (i < S.length - 2 && z > S[i + 1].z) i++;
    const a = S[i], b = S[i + 1];
    const t = THREE.MathUtils.clamp((z - a.z) / ((b.z - a.z) || 1), 0, 1);
    const rx = a.rx + (b.rx - a.rx) * t + out;
    const ry = a.ry + (b.ry - a.ry) * t + out;
    const cy = (a.cy || 0) + ((b.cy || 0) - (a.cy || 0)) * t;
    const n = (a.n ?? 2.4) + ((b.n ?? 2.4) - (a.n ?? 2.4)) * t;
    const e = 2 / n;
    const c = Math.sin(theta), s = Math.cos(theta);
    return [
      Math.sign(c) * Math.pow(Math.abs(c), e) * rx,
      cy + Math.sign(s) * Math.pow(Math.abs(s), e) * ry,
      z
    ];
  }

  /** The fuselage centreline height at a station — what "outward" is from. */
  _axisY(z) {
    const S = this._sections;
    let i = 0;
    while (i < S.length - 2 && z > S[i + 1].z) i++;
    const a = S[i], b = S[i + 1];
    const t = THREE.MathUtils.clamp((z - a.z) / ((b.z - a.z) || 1), 0, 1);
    return (a.cy || 0) + ((b.cy || 0) - (a.cy || 0)) * t;
  }

  /** Loft the fuselage from its section table and remember it for _skin. */
  _fuselage(sections, mat, segs = 18) {
    this._sections = sections;
    const rings = sections.map((s) => ellipseRing(segs, s.rx, s.ry, {
      n: s.n ?? 2.4, cy: s.cy ?? 0, z: s.z, flatBottom: s.flat || 0
    }));
    this._st(loft(rings, { capStart: true, capEnd: true }), mat);
  }

  /** A panel lying on the skin: windows, doors, cheat lines, service panels. */
  _skinPanel(z0, z1, th0, th1, mat, out = 0.012, cols = 3, rows = 2) {
    const zc = (z0 + z1) / 2;
    const mid = this._skin(zc, (th0 + th1) / 2, out);
    // Outward is measured from the fuselage axis AT THIS STATION. Measuring it
    // from the tail's centreline put the reference metres away on a body that
    // rises toward the fin, and every panel forward of the wing came out wound
    // inside-out — invisible from the street, solid from inside the cabin.
    const geo = gridPatch(cols, rows, (u, v) => this._skin(
      z0 + (z1 - z0) * u, th0 + (th1 - th0) * v, out
    ), new THREE.Vector3(mid[0], mid[1] - this._axisY(zc), 0).normalize());
    this._st(geo, mat);
    return geo;
  }

  // ----------------------------------------------------------------- build

  _build() {
    const t = this.type;
    const accent = LIVERY[(Math.random() * LIVERY.length) | 0];

    // Painted aluminium: a metallic basecoat under clear, same as the cars.
    // Without the clearcoat an airframe reads as grey plastic in every light.
    this.mats = {
      body: new THREE.MeshPhysicalMaterial({
        color: 0xe9ecf0, roughness: 0.3, metalness: 0.62,
        clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.4
      }),
      accent: new THREE.MeshPhysicalMaterial({
        color: accent, roughness: 0.32, metalness: 0.5,
        clearcoat: 1.0, clearcoatRoughness: 0.1
      }),
      trim: new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.62, metalness: 0.45 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.85, metalness: 0.1 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc4cad1, roughness: 0.26, metalness: 0.95 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.95 }),
      // Cabin glass seen from outside is dark and reflective; the flight deck
      // has to be see-through, because you look out of it.
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x1b2630, roughness: 0.04, metalness: 0.14,
        transparent: true, opacity: 0.74, clearcoat: 1, clearcoatRoughness: 0.02,
        envMapIntensity: 2.0, depthWrite: false
      }),
      screen: new THREE.MeshPhysicalMaterial({
        color: 0x5b7180, roughness: 0.03, metalness: 0.16,
        transparent: true, opacity: 0.44, clearcoat: 1, clearcoatRoughness: 0.02,
        envMapIntensity: 1.9, depthWrite: false
      }),
      cabin: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 })
    };
    // Lamps are handles, because they flash.
    this.lamps = {
      port: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff2818, emissiveIntensity: 1.6, roughness: 0.3 }),
      stbd: new THREE.MeshStandardMaterial({ color: 0x052a10, emissive: 0x2cff60, emissiveIntensity: 1.6, roughness: 0.3 }),
      strobe: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.25 }),
      beacon: new THREE.MeshStandardMaterial({ color: 0x2a0606, emissive: 0xff3020, emissiveIntensity: 0.4, roughness: 0.3 }),
      land: new THREE.MeshStandardMaterial({ color: 0x201d10, emissive: 0xfff2cc, emissiveIntensity: 0.3, roughness: 0.2 })
    };

    // Moving parts, collected so fly() can drive them without searching.
    this.surfaces = { ail: [], elev: [], rudder: null, flap: [] };
    this.gear = [];
    this.blurs = [];

    if (t.id === 'heli') this._buildHeli();
    else if (t.id === 'jet') this._buildJet();
    else this._buildProp();

    this._registration(accent);
  }

  /** A registration on the fin, so no two aircraft on the apron are twins. */
  _registration(accent) {
    const code = 'SK-' + String.fromCharCode(65 + ((Math.random() * 26) | 0))
      + String.fromCharCode(65 + ((Math.random() * 26) | 0))
      + ((Math.random() * 90 + 10) | 0);
    this.reg = code;
    const p = this.regPlate;
    if (!p) return;
    const mat = new THREE.MeshStandardMaterial({
      map: regTexture(code, 0xf2f4f7), transparent: true, roughness: 0.6,
      metalness: 0.1, depthWrite: false, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.w * 0.5), mat);
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = Math.PI / 2;
    this.group.add(m);
    const m2 = m.clone();
    m2.position.x = -p.x;
    m2.rotation.y = -Math.PI / 2;
    this.group.add(m2);
  }

  // ------------------------------------------------------- the light plane

  /**
   * A high-wing single: the shape everybody pictures when they hear "small
   * plane". Strut-braced wing over a glasshouse cabin, fixed tricycle gear in
   * spats, and a big slow propeller on the nose.
   */
  _buildProp() {
    const t = this.type;
    const M = this.mats;
    const L = t.l, HB = 1.62;                  // fuselage centreline height

    this._fuselage([
      { z: -L * 0.50, rx: 0.05, ry: 0.06, cy: HB + 0.50, n: 2.2 },
      { z: -L * 0.40, rx: 0.17, ry: 0.22, cy: HB + 0.36, n: 2.3 },
      { z: -L * 0.26, rx: 0.31, ry: 0.38, cy: HB + 0.18, n: 2.4 },
      { z: -L * 0.10, rx: 0.52, ry: 0.60, cy: HB + 0.04, n: 2.6 },
      { z: L * 0.06, rx: 0.60, ry: 0.70, cy: HB, n: 2.7, flat: 0.15 },
      { z: L * 0.22, rx: 0.58, ry: 0.66, cy: HB, n: 2.6, flat: 0.15 },
      { z: L * 0.34, rx: 0.50, ry: 0.54, cy: HB + 0.02, n: 2.4 },
      { z: L * 0.44, rx: 0.34, ry: 0.36, cy: HB + 0.02, n: 2.3 },
      { z: L * 0.50, rx: 0.20, ry: 0.21, cy: HB + 0.02, n: 2.2 }
    ], M.body, 18);

    // Cheat line down the flank and a belly panel, so the fuselage is not one
    // uninterrupted white tube.
    for (const s of [1, -1]) {
      // Two narrow lines rather than one broad band — a 0.27-radian sweep
      // straddling the widest part of the flank is a quarter of the side of
      // the aeroplane painted green.
      this._skinPanel(-L * 0.40, L * 0.42, s * 1.52, s * 1.63, M.accent, 0.012, 10, 1);
      this._skinPanel(-L * 0.40, L * 0.42, s * 1.68, s * 1.73, M.trim, 0.011, 10, 1);
      this._skinPanel(-L * 0.30, L * 0.30, s * 2.55, s * 3.05, M.trim, 0.010, 8, 2);
    }

    // --- Glasshouse -------------------------------------------------------
    // A light aircraft is mostly window from the firewall back to the wing.
    // Windscreen first, raked back off the cowl, then side and rear glazing.
    for (const s of [1, -1]) {
      this._skinPanel(L * 0.30, L * 0.44, s * 0.40, s * 1.20, M.screen, 0.016, 4, 4);
      this._skinPanel(L * 0.02, L * 0.29, s * 0.92, s * 1.44, M.glass, 0.016, 5, 3);
      this._skinPanel(-L * 0.20, L * 0.00, s * 0.95, s * 1.42, M.glass, 0.016, 4, 3);
      // Window frames, a shade proud of the glass.
      this._skinPanel(L * 0.005, L * 0.012, s * 0.92, s * 1.44, M.trim, 0.020, 1, 3);
      // Door outline and handle.
      this._skinPanel(L * 0.01, L * 0.018, s * 1.44, s * 2.50, M.trim, 0.016, 1, 3);
      this._skinPanel(L * 0.285, L * 0.292, s * 1.44, s * 2.50, M.trim, 0.016, 1, 3);
      const h = this._skin(L * 0.16, s * 1.98, 0.05);
      this._put(new THREE.BoxGeometry(0.07, 0.05, 0.16), M.chrome, h[0], h[1], h[2]);
      // Wing strut: the brace that says "high wing" from a mile away. The foot
      // is taken off the SKIN, so it starts on the side of the fuselage rather
      // than somewhere inside it with most of its length swallowed.
      const foot = this._skin(L * 0.02, s * 2.25, -0.02);
      this._strut(foot, [s * 2.35, 2.26, L * 0.06], 0.05, M.body, 6);
      const foot2 = this._skin(-L * 0.06, s * 2.25, -0.02);
      this._strut(foot2, [s * 2.05, 2.28, -L * 0.02], 0.04, M.body, 6);
      // Step below the door.
      this._strut([s * 0.45, 0.72, L * 0.10], [s * 0.72, 0.62, L * 0.10], 0.028, M.chrome, 5);
    }
    // Overhead glazing between the wing roots.
    this._skinPanel(L * 0.10, L * 0.30, -0.34, 0.34, M.glass, 0.016, 3, 3);

    // --- Wing: high, mildly tapered, no sweep -----------------------------
    const half = t.w * 0.5;
    const WY = 2.32;
    for (const s of [1, -1]) {
      const g = wingGeometry({
        span: half, rootChord: 1.62, tipChord: 1.18, sweep: 0.03, dihedral: 0.025,
        thick: 0.15, camber: 0.028, twist: -0.045, chordFrac: 0.76,
        side: s, stations: 5, segs: 9, rootY: WY, rootZ: L * 0.12
      });
      this._st(g, M.body);
      // Wing-root fairing into the cabin roof.
      this._put(new THREE.BoxGeometry(0.5, 0.12, 1.5), M.body, s * 0.32, WY - 0.04, L * 0.03);
      // Flap inboard, aileron outboard — both hinged, both real.
      const flap = new THREE.Mesh(surfaceGeometry({
        span: half * 0.44, rootChord: 0.40, tipChord: 0.36, sweep: 0.02,
        dihedral: 0.025, thick: 0.05, side: s, stations: 2
      }), M.body);
      flap.position.set(0, WY, L * 0.12 - 1.62 * 0.76);
      this.group.add(flap);
      this.surfaces.flap.push({ mesh: flap, side: s });

      const ail = new THREE.Mesh(surfaceGeometry({
        span: half * 0.38, rootChord: 0.36, tipChord: 0.30, sweep: 0.02,
        dihedral: 0.025, thick: 0.05, side: s, stations: 2
      }), M.accent);
      ail.position.set(s * half * 0.56, WY + 0.025 * half * 0.56, L * 0.12 - 1.42 * 0.76);
      this.group.add(ail);
      this.surfaces.ail.push({ mesh: ail, side: s });

      // Tip fairing, nav light and a landing light in the leading edge.
      this._put(new THREE.SphereGeometry(0.16, 10, 8), M.body,
        s * half, WY + 0.025 * half, L * 0.12 - 0.6);
      this._put(new THREE.BoxGeometry(0.1, 0.09, 0.1), s > 0 ? this.lamps.stbd : this.lamps.port,
        s * (half + 0.02), WY + 0.025 * half, L * 0.12 - 0.5);
      this._put(new THREE.BoxGeometry(0.06, 0.05, 0.05), this.lamps.strobe,
        s * (half + 0.02), WY + 0.025 * half + 0.08, L * 0.12 - 0.62);
      this._put(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10), this.lamps.land,
        s * 1.5, WY + 0.02, L * 0.12 + 0.18, Math.PI / 2);
    }

    // --- Tail -------------------------------------------------------------
    // Fin and rudder above, tailplane and elevators either side.
    this._st(wingGeometry({
      span: 1.42, rootChord: 1.30, tipChord: 0.72, sweep: 0.62, dihedral: 0,
      thick: 0.11, camber: 0, twist: 0, chordFrac: 0.66, side: 1,
      stations: 4, segs: 7, rootY: 0, rootZ: 0
    }).rotateZ(Math.PI / 2).translate(0, HB + 0.30, -L * 0.40), M.accent);

    const rud = new THREE.Mesh(surfaceGeometry({
      span: 1.32, rootChord: 0.52, tipChord: 0.34, sweep: 0.42, thick: 0.05,
      side: 1, stations: 3
    }).rotateZ(Math.PI / 2), M.accent);
    rud.position.set(0, HB + 0.32, -L * 0.40 - 1.30 * 0.66);
    this.group.add(rud);
    this.surfaces.rudder = rud;
    this.regPlate = { x: 0.055, y: HB + 1.05, z: -L * 0.40 - 0.42, w: 0.78 };

    for (const s of [1, -1]) {
      this._st(wingGeometry({
        span: 1.65, rootChord: 1.02, tipChord: 0.66, sweep: 0.22, dihedral: 0,
        thick: 0.10, camber: 0, twist: 0, chordFrac: 0.6, side: s,
        stations: 3, segs: 7, rootY: HB + 0.22, rootZ: -L * 0.38
      }), M.body);
      const el = new THREE.Mesh(surfaceGeometry({
        span: 1.6, rootChord: 0.42, tipChord: 0.30, sweep: 0.2, thick: 0.045,
        side: s, stations: 2
      }), M.body);
      el.position.set(0, HB + 0.22, -L * 0.38 - 1.02 * 0.6);
      this.group.add(el);
      this.surfaces.elev.push({ mesh: el, side: s });
    }

    // --- Engine: cowl, spinner, three blades, exhaust ---------------------
    const nose = L * 0.50;
    this._st(loft([
      ellipseRing(14, 0.34, 0.35, { cy: HB + 0.02, z: nose - 0.02, n: 2.4 }),
      ellipseRing(14, 0.26, 0.27, { cy: HB + 0.02, z: nose + 0.16, n: 2.4 }),
      ellipseRing(14, 0.16, 0.17, { cy: HB + 0.02, z: nose + 0.26, n: 2.4 })
    ], { capStart: false, capEnd: true }), M.accent);
    // Cooling intakes either side of the spinner.
    for (const s of [1, -1]) {
      this._put(new THREE.BoxGeometry(0.16, 0.11, 0.06), M.dark, s * 0.20, HB - 0.08, nose + 0.22);
    }
    this._put(new THREE.CylinderGeometry(0.05, 0.035, 0.5, 8), M.trim,
      0.26, HB - 0.24, nose - 0.20, Math.PI / 2);

    const propHub = new THREE.Group();
    propHub.position.set(0, HB + 0.02, nose + 0.30);
    this.group.add(propHub);
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 12), M.accent);
    spin.rotation.x = Math.PI / 2;
    spin.position.z = 0.16;
    propHub.add(spin);
    for (let b = 0; b < 3; b++) {
      // A blade IS a wing: aerofoil section, tapered, and heavily twisted from
      // root to tip. That twist is why a propeller catches the light in a
      // band rather than flashing flat like a plank.
      const blade = new THREE.Mesh(wingGeometry({
        span: 1.18, rootChord: 0.30, tipChord: 0.16, sweep: 0.02, dihedral: 0,
        thick: 0.16, camber: 0.03, twist: -0.85, side: 1, stations: 4, segs: 7,
        taperCurve: 1.6
      }), M.dark);
      blade.rotation.z = (b / 3) * Math.PI * 2;
      propHub.add(blade);
      // Yellow tip, as every propeller in the world carries.
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 }));
      tip.position.set(Math.cos((b / 3) * Math.PI * 2) * 1.12, Math.sin((b / 3) * Math.PI * 2) * 1.12, 0);
      propHub.add(tip);
    }
    this.rotor = propHub;
    this.blades = propHub;
    this._addBlur(propHub, 1.22, 0, 0.02);

    // --- Fixed gear in spats ----------------------------------------------
    this._legs([
      { x: 0, z: L * 0.34, r: 0.22, nose: true },
      { x: 1.28, z: -L * 0.02, r: 0.28 },
      { x: -1.28, z: -L * 0.02, r: 0.28 }
    ], HB - 0.52, false);

    // Beacon on the spine, and the cabin.
    this._put(new THREE.SphereGeometry(0.08, 8, 6), this.lamps.beacon, 0, HB + 0.72, -L * 0.24);
    // The floor goes near the BOTTOM of the fuselage, not near its middle:
    // a seat on the centreline puts the pilot's head through the roof.
    this._cabin(HB - 0.58, L * 0.22, 0.52, 2);
    this.eye = new THREE.Vector3(0.36, HB + 0.26, L * 0.22);
  }

  // -------------------------------------------------------- the light jet

  /** A business jet: swept low wing, winglets, rear-fuselage engines, T-tail. */
  _buildJet() {
    const t = this.type;
    const M = this.mats;
    const L = t.l, HB = 2.05, R = 1.0;

    this._fuselage([
      { z: -L * 0.50, rx: 0.06, ry: 0.07, cy: HB + 0.66, n: 2.3 },
      { z: -L * 0.42, rx: 0.26, ry: 0.30, cy: HB + 0.52, n: 2.4 },
      { z: -L * 0.32, rx: 0.52, ry: 0.58, cy: HB + 0.34, n: 2.5 },
      { z: -L * 0.18, rx: 0.82, ry: 0.88, cy: HB + 0.14, n: 2.6 },
      { z: -L * 0.02, rx: R, ry: R * 1.04, cy: HB, n: 2.7 },
      { z: L * 0.18, rx: R, ry: R * 1.04, cy: HB, n: 2.7 },
      { z: L * 0.30, rx: 0.94, ry: 0.96, cy: HB + 0.02, n: 2.6 },
      { z: L * 0.40, rx: 0.72, ry: 0.70, cy: HB - 0.02, n: 2.4 },
      { z: L * 0.47, rx: 0.42, ry: 0.40, cy: HB - 0.10, n: 2.3 },
      { z: L * 0.50, rx: 0.14, ry: 0.13, cy: HB - 0.16, n: 2.2 }
    ], M.body, 20);

    // Livery: a broad sweep along the belly and a cheat line at window height.
    for (const s of [1, -1]) {
      this._skinPanel(-L * 0.44, L * 0.44, s * 1.50, s * 1.66, M.accent, 0.012, 12, 2);
      this._skinPanel(-L * 0.40, L * 0.42, s * 2.40, s * 3.14, M.accent, 0.010, 12, 3);
      // Cabin window line, curved onto the skin — eight oval ports a side.
      for (let i = 0; i < 8; i++) {
        const wz = L * (0.24 - i * 0.062);
        this._skinPanel(wz - 0.11, wz + 0.11, s * 1.30, s * 1.62, M.glass, 0.014, 2, 2);
      }
      // Flight-deck glazing: a wrapped screen plus a quarterlight.
      this._skinPanel(L * 0.34, L * 0.455, s * 0.30, s * 1.05, M.screen, 0.016, 4, 4);
      this._skinPanel(L * 0.28, L * 0.335, s * 0.72, s * 1.24, M.screen, 0.016, 2, 3);
      this._skinPanel(L * 0.332, L * 0.342, s * 0.30, s * 1.24, M.trim, 0.020, 1, 4);
      // Airstair door outline, forward left, with a handle.
      if (s < 0) {
        this._skinPanel(L * 0.10, L * 0.115, s * 1.62, s * 2.70, M.trim, 0.014, 1, 4);
        this._skinPanel(L * 0.255, L * 0.270, s * 1.62, s * 2.70, M.trim, 0.014, 1, 4);
        const h = this._skin(L * 0.18, s * 2.20, 0.05);
        this._put(new THREE.BoxGeometry(0.06, 0.16, 0.05), M.chrome, h[0], h[1], h[2]);
      }
    }
    // Radome: a darker cap on the nose.
    this._skinPanel(L * 0.455, L * 0.50, -Math.PI, Math.PI, M.trim, 0.008, 12, 2);

    // --- Swept low wing with winglets -------------------------------------
    const half = t.w * 0.5;
    const WY = 1.42;
    for (const s of [1, -1]) {
      this._st(wingGeometry({
        span: half, rootChord: 2.5, tipChord: 0.95, sweep: 0.52, dihedral: 0.055,
        thick: 0.11, camber: 0.014, twist: -0.06, chordFrac: 0.74,
        side: s, stations: 6, segs: 9, rootY: WY, rootZ: L * 0.02, taperCurve: 0.85
      }), M.body);
      // Root fairing blending wing into belly — the shape that stops a wing
      // looking like a plank pushed through a tube.
      this._st(loft([
        ellipseRing(10, 0.30, 0.26, { cx: s * 0.72, cy: WY + 0.02, z: L * 0.20, n: 2.6 }),
        ellipseRing(10, 0.46, 0.34, { cx: s * 0.78, cy: WY - 0.02, z: L * 0.02, n: 2.6 }),
        ellipseRing(10, 0.30, 0.22, { cx: s * 0.84, cy: WY - 0.10, z: -L * 0.20, n: 2.6 })
      ], { capStart: true, capEnd: true }), M.body);

      const flap = new THREE.Mesh(surfaceGeometry({
        span: half * 0.42, rootChord: 0.62, tipChord: 0.46, sweep: 0.5,
        dihedral: 0.055, thick: 0.05, side: s, stations: 2
      }), M.body);
      flap.position.set(s * half * 0.16, WY + 0.055 * half * 0.16, L * 0.02 - 2.26 * 0.74);
      this.group.add(flap);
      this.surfaces.flap.push({ mesh: flap, side: s });

      const ail = new THREE.Mesh(surfaceGeometry({
        span: half * 0.32, rootChord: 0.42, tipChord: 0.30, sweep: 0.5,
        dihedral: 0.055, thick: 0.045, side: s, stations: 2
      }), M.accent);
      ail.position.set(s * half * 0.62, WY + 0.055 * half * 0.62, L * 0.02 - 0.52 * half * 0.62 - 1.36 * 0.74);
      this.group.add(ail);
      this.surfaces.ail.push({ mesh: ail, side: s });

      // Winglet: a small swept fin standing off the tip, canted outboard.
      const wl = wingGeometry({
        span: 0.92, rootChord: 0.88, tipChord: 0.42, sweep: 0.68, dihedral: 0,
        thick: 0.09, camber: 0, twist: 0, side: 1, stations: 3, segs: 7
      });
      // Both winglets stand up. Mirroring the rotation with the side sent the
      // port one straight down through the wing.
      wl.rotateZ(Math.PI / 2);
      wl.translate(s * half, WY + 0.055 * half, L * 0.02 - 0.52 * half);
      this._st(wl, M.accent);
      this._put(new THREE.BoxGeometry(0.1, 0.09, 0.1), s > 0 ? this.lamps.stbd : this.lamps.port,
        s * (half + 0.03), WY + 0.055 * half, L * 0.02 - 0.52 * half - 0.4);
      this._put(new THREE.BoxGeometry(0.06, 0.05, 0.05), this.lamps.strobe,
        s * (half + 0.03), WY + 0.055 * half + 0.1, L * 0.02 - 0.52 * half - 0.5);

      // --- Engine on a pylon off the rear fuselage ------------------------
      const ex = s * (R + 0.78), ey = HB + 0.30, ez = -L * 0.28;
      // Pylon.
      this._st(wingGeometry({
        span: 0.66, rootChord: 1.5, tipChord: 1.2, sweep: 0.3, dihedral: 0,
        thick: 0.14, camber: 0, twist: 0, side: s, stations: 2, segs: 6,
        rootY: ey, rootZ: ez + 0.5
      }), M.body);
      // Nacelle: an intake lip, a barrel and an exhaust cone.
      const nac = [];
      // Intake forward (+Z), exhaust aft. The nose of every vehicle in this
      // game points toward +Z, so a nacelle built the other way round is an
      // engine mounted backwards.
      const prof = [
        [1.30, 0.50], [0.95, 0.60], [0.40, 0.64], [-0.35, 0.63],
        [-0.90, 0.56], [-1.15, 0.46], [-1.20, 0.40]
      ];
      for (const [dz, r] of prof) nac.push(ellipseRing(16, r, r, { cx: ex, cy: ey, z: ez + dz, n: 2 }));
      this._st(loft(nac, { capStart: false, capEnd: false }), M.body);
      // Intake lip rolled inward, and a dark throat behind it.
      this._st(loft([
        ellipseRing(16, 0.50, 0.50, { cx: ex, cy: ey, z: ez + 1.30, n: 2 }),
        ellipseRing(16, 0.44, 0.44, { cx: ex, cy: ey, z: ez + 1.18, n: 2 }),
        ellipseRing(16, 0.42, 0.42, { cx: ex, cy: ey, z: ez + 0.80, n: 2 })
      ], { capStart: false, capEnd: false }), M.chrome);
      this._put(new THREE.CircleGeometry(0.42, 16), M.dark, ex, ey, ez + 0.78, 0, Math.PI, 0);
      // Fan face: a ring of blades you can just see down the intake.
      const fan = new THREE.Group();
      fan.position.set(ex, ey, ez + 0.74);
      for (let b = 0; b < 12; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.03), M.chrome);
        bl.position.set(Math.cos((b / 12) * Math.PI * 2) * 0.24, Math.sin((b / 12) * Math.PI * 2) * 0.24, 0);
        bl.rotation.z = (b / 12) * Math.PI * 2 + 0.6;
        fan.add(bl);
      }
      this.group.add(fan);
      this.fans = this.fans || [];
      this.fans.push(fan);
      // Exhaust cone and nozzle.
      this._put(new THREE.ConeGeometry(0.26, 0.7, 14), M.trim, ex, ey, ez - 1.34, Math.PI / 2);
      this._st(loft([
        ellipseRing(16, 0.40, 0.40, { cx: ex, cy: ey, z: ez - 1.20, n: 2 }),
        ellipseRing(16, 0.36, 0.36, { cx: ex, cy: ey, z: ez - 1.42, n: 2 })
      ], { capStart: false, capEnd: false }), M.trim);
    }

    // --- T-tail -----------------------------------------------------------
    const finH = 2.55;
    this._st(wingGeometry({
      span: finH, rootChord: 2.3, tipChord: 1.15, sweep: 1.5, dihedral: 0,
      thick: 0.10, camber: 0, twist: 0, chordFrac: 0.7, side: 1,
      stations: 4, segs: 7, rootY: 0, rootZ: 0
    }).rotateZ(Math.PI / 2).translate(0, HB + 0.44, -L * 0.34), M.accent);
    // Dorsal fillet running the fin into the spine.
    this._st(wingGeometry({
      span: 0.9, rootChord: 1.9, tipChord: 1.4, sweep: 1.3, dihedral: 0,
      thick: 0.07, camber: 0, twist: 0, side: 1, stations: 2, segs: 5,
      rootY: 0, rootZ: 0
    }).rotateZ(Math.PI / 2).translate(0, HB + 0.30, -L * 0.20), M.accent);

    const rud = new THREE.Mesh(surfaceGeometry({
      span: 2.4, rootChord: 0.66, tipChord: 0.40, sweep: 1.0, thick: 0.045,
      side: 1, stations: 3
    }).rotateZ(Math.PI / 2), M.accent);
    rud.position.set(0, HB + 0.5, -L * 0.34 - 2.3 * 0.7);
    this.group.add(rud);
    this.surfaces.rudder = rud;
    this.regPlate = { x: 0.06, y: HB + 1.7, z: -L * 0.34 - 1.9, w: 0.9 };

    const TY = HB + 0.44 + finH;
    const TZ = -L * 0.34 - 1.5;
    for (const s of [1, -1]) {
      this._st(wingGeometry({
        span: 1.85, rootChord: 1.24, tipChord: 0.74, sweep: 0.42, dihedral: 0.02,
        thick: 0.09, camber: 0, twist: 0, chordFrac: 0.62, side: s,
        stations: 3, segs: 7, rootY: TY, rootZ: TZ
      }), M.body);
      const el = new THREE.Mesh(surfaceGeometry({
        span: 1.8, rootChord: 0.48, tipChord: 0.32, sweep: 0.4, dihedral: 0.02,
        thick: 0.04, side: s, stations: 2
      }), M.body);
      el.position.set(0, TY, TZ - 1.24 * 0.62);
      this.group.add(el);
      this.surfaces.elev.push({ mesh: el, side: s });
    }
    // Tail nav light, and the anti-collision beacon on the spine.
    this._put(new THREE.BoxGeometry(0.08, 0.08, 0.08), this.lamps.strobe, 0, TY + 0.06, TZ - 1.0);
    this._put(new THREE.SphereGeometry(0.09, 8, 6), this.lamps.beacon, 0, HB + 1.12, -L * 0.14);

    // --- Retractable tricycle gear ----------------------------------------
    this._legs([
      { x: 0, z: L * 0.30, r: 0.30, nose: true },
      { x: 1.30, z: -L * 0.06, r: 0.36, twin: true },
      { x: -1.30, z: -L * 0.06, r: 0.36, twin: true }
    ], HB - 1.0, true);

    this._cabin(HB - 0.85, L * 0.30, 0.78, 3);
    this.eye = new THREE.Vector3(0.40, HB + 0.18, L * 0.33);
  }

  // ------------------------------------------------------- the helicopter

  /** A utility helicopter: bubble nose, pod cabin, tapered boom, skids. */
  _buildHeli() {
    const t = this.type;
    const M = this.mats;
    const L = t.l, HB = 1.95;

    // Pod and boom in one loft: fat over the cabin, pinched into the tail.
    this._fuselage([
      { z: -L * 0.50, rx: 0.10, ry: 0.13, cy: HB + 0.50, n: 2.3 },
      { z: -L * 0.42, rx: 0.17, ry: 0.20, cy: HB + 0.44, n: 2.4 },
      { z: -L * 0.26, rx: 0.24, ry: 0.27, cy: HB + 0.32, n: 2.5 },
      { z: -L * 0.12, rx: 0.42, ry: 0.48, cy: HB + 0.18, n: 2.6 },
      { z: L * 0.00, rx: 0.78, ry: 0.80, cy: HB + 0.04, n: 2.8, flat: 0.2 },
      { z: L * 0.16, rx: 0.88, ry: 0.86, cy: HB, n: 2.9, flat: 0.25 },
      { z: L * 0.30, rx: 0.84, ry: 0.78, cy: HB - 0.04, n: 2.7, flat: 0.2 },
      { z: L * 0.42, rx: 0.62, ry: 0.58, cy: HB - 0.12, n: 2.3 },
      { z: L * 0.50, rx: 0.22, ry: 0.22, cy: HB - 0.22, n: 2.2 }
    ], M.body, 18);

    for (const s of [1, -1]) {
      // The bubble: a helicopter's whole front is glass, right under your feet.
      // Dark glass, not the clear windscreen material — over a white pod the
      // clear one reads as a smear of grey paint rather than a canopy.
      this._skinPanel(L * 0.26, L * 0.50, s * 0.10, s * 1.30, M.glass, 0.016, 5, 5);
      this._skinPanel(L * 0.30, L * 0.50, s * 1.30, s * 2.30, M.glass, 0.016, 4, 3);
      // Canopy framing: a post either side of the screen and one over the top.
      this._skinPanel(L * 0.255, L * 0.268, s * 0.10, s * 2.30, M.trim, 0.022, 1, 5);
      this._skinPanel(L * 0.26, L * 0.50, s * 1.28, s * 1.33, M.trim, 0.021, 4, 1);
      // Sliding cabin door, framed, with a window and a rail.
      this._skinPanel(-L * 0.10, L * 0.16, s * 1.05, s * 2.30, M.accent, 0.014, 4, 4);
      this._skinPanel(-L * 0.04, L * 0.10, s * 1.20, s * 1.80, M.glass, 0.026, 3, 2);
      const r0 = this._skin(-L * 0.12, s * 1.6, 0.05), r1 = this._skin(L * 0.18, s * 1.6, 0.05);
      this._strut(r0, r1, 0.022, M.chrome, 5);
      // Livery flash along the boom.
      this._skinPanel(-L * 0.46, -L * 0.04, s * 1.35, s * 1.75, M.accent, 0.012, 8, 2);
    }

    // --- Skids -------------------------------------------------------------
    // Two rails on two arched cross tubes. The arch is the shape that makes a
    // helicopter read as a helicopter from the side, and the previous version
    // — four straight sticks aimed at a point buried inside the fuselage —
    // came out as scattered fragments under a floating pod.
    const skidY = 0.09, belly = HB - 0.88;
    for (const s of [1, -1]) {
      this._st(tube([
        [s * 1.18, skidY + 0.02, -L * 0.28], [s * 1.18, skidY, -L * 0.05],
        [s * 1.18, skidY, L * 0.18], [s * 1.15, skidY + 0.10, L * 0.30],
        [s * 1.02, skidY + 0.34, L * 0.38]
      ], 0.075, 8), M.chrome);
      // Step on the skid, where you put your boot getting in.
      this._put(new THREE.BoxGeometry(0.34, 0.05, 0.55), M.trim, s * 1.18, skidY + 0.14, L * 0.04);
    }
    for (const cz of [-L * 0.16, L * 0.16]) {
      this._st(tube([
        [-1.18, skidY + 0.04, cz], [-0.98, belly - 0.42, cz], [-0.42, belly - 0.02, cz],
        [0.42, belly - 0.02, cz], [0.98, belly - 0.42, cz], [1.18, skidY + 0.04, cz]
      ], 0.055, 7), M.chrome);
    }

    // --- Tail: boom fin, stabiliser, tail rotor ---------------------------
    this._st(wingGeometry({
      span: 1.15, rootChord: 1.25, tipChord: 0.62, sweep: 0.55, dihedral: 0,
      thick: 0.11, camber: 0, twist: 0, side: 1, stations: 3, segs: 7,
      rootY: 0, rootZ: 0
    }).rotateZ(Math.PI / 2).translate(0, HB + 0.48, -L * 0.42), M.accent);
    // Ventral fin, which is what stops the boom reading as a broomstick.
    this._st(wingGeometry({
      span: 0.55, rootChord: 0.8, tipChord: 0.42, sweep: 0.3, dihedral: 0,
      thick: 0.1, camber: 0, twist: 0, side: 1, stations: 2, segs: 6,
      rootY: 0, rootZ: 0
    }).rotateZ(-Math.PI / 2).translate(0, HB + 0.34, -L * 0.46), M.accent);
    for (const s of [1, -1]) {
      this._st(wingGeometry({
        span: 0.88, rootChord: 0.66, tipChord: 0.44, sweep: 0.12, dihedral: 0,
        thick: 0.1, camber: 0, twist: 0, side: s, stations: 2, segs: 6,
        rootY: HB + 0.36, rootZ: -L * 0.34
      }), M.body);
    }
    this.regPlate = { x: 0.07, y: HB + 0.92, z: -L * 0.42 - 0.5, w: 0.7 };

    // Tail gearbox and the rotor itself, out on the side of the fin where you
    // can actually see it turning.
    this._put(new THREE.SphereGeometry(0.20, 10, 8), M.trim, 0.10, HB + 1.05, -L * 0.45);
    this._put(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 8), M.chrome, 0.20, HB + 1.05, -L * 0.45, 0, 0, Math.PI / 2);
    const tr = new THREE.Group();
    tr.position.set(0.32, HB + 1.05, -L * 0.45);
    tr.rotation.y = Math.PI / 2;
    this.group.add(tr);
    tr.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 8), M.chrome).rotateX(Math.PI / 2));
    for (let b = 0; b < 2; b++) {
      const bl = new THREE.Mesh(wingGeometry({
        span: 0.88, rootChord: 0.22, tipChord: 0.17, sweep: 0, dihedral: 0,
        thick: 0.16, camber: 0.02, twist: -0.3, side: 1, stations: 2, segs: 6
      }), M.dark);
      bl.rotation.z = b * Math.PI;
      tr.add(bl);
    }
    this.tailRotor = tr;
    this._addBlur(tr, 0.92, 0, 0);

    // --- Main rotor: hub, mast, four blades, links, blur ------------------
    const MY = HB + 1.28;
    this._put(new THREE.CylinderGeometry(0.22, 0.30, 0.55, 12), M.trim, 0, MY - 0.3, L * 0.06);
    const mast = new THREE.Group();
    mast.position.set(0, MY, L * 0.06);
    // Laid flat. Blades are built in the group's XY plane and spun about its
    // Z; without this the main rotor is a vertical disc turning like a
    // paddle wheel over the cabin.
    mast.rotation.x = -Math.PI / 2;
    this.group.add(mast);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.20, 12), M.chrome);
    mast.add(hub);
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2;
      const bl = new THREE.Mesh(wingGeometry({
        span: 5.6, rootChord: 0.34, tipChord: 0.28, sweep: 0, dihedral: 0.012,
        thick: 0.13, camber: 0.022, twist: -0.16, side: 1, stations: 4, segs: 7
      }), M.dark);
      bl.rotation.z = a;
      // A blade droops when it isn't flying — the thing you notice about a
      // parked helicopter before anything else.
      bl.rotation.y = 0;
      mast.add(bl);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.18), M.chrome);
      grip.position.set(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0);
      grip.rotation.z = a;
      mast.add(grip);
      // Pitch link down to the swashplate.
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), M.chrome);
      link.position.set(Math.cos(a + 0.4) * 0.3, Math.sin(a + 0.4) * 0.3, -0.22);
      link.rotation.x = Math.PI / 2;
      mast.add(link);
    }
    this.rotor = mast;
    this.blades = mast;
    this._addBlur(mast, 5.7, 0, 0);
    // Swashplate, fixed to the airframe below the spinning hub.
    this._put(new THREE.CylinderGeometry(0.28, 0.28, 0.07, 12), M.chrome, 0, MY - 0.36, L * 0.06);

    // Lights: nav each side, beacon on the boom, landing light in the nose.
    this._put(new THREE.BoxGeometry(0.09, 0.08, 0.09), this.lamps.port, -0.86, HB + 0.1, L * 0.10);
    this._put(new THREE.BoxGeometry(0.09, 0.08, 0.09), this.lamps.stbd, 0.86, HB + 0.1, L * 0.10);
    this._put(new THREE.SphereGeometry(0.09, 8, 6), this.lamps.beacon, 0, HB + 0.62, -L * 0.22);
    this._put(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10), this.lamps.land, 0, HB - 0.62, L * 0.34, Math.PI / 2);

    this._cabin(HB - 0.72, L * 0.28, 0.6, 2, true);
    this.eye = new THREE.Vector3(0.42, HB + 0.22, L * 0.28);
  }

  // ------------------------------------------------------- shared fittings

  /**
   * The flight deck, because the cockpit camera puts you in it.
   *
   * From the seat an aircraft is not a silhouette — it's a glareshield, a
   * panel of instruments, a yoke in front of you and a throttle quadrant at
   * your elbow. Nothing else tells you you're flying rather than floating.
   */
  _cabin(floorY, deckZ, halfW, rows, stick = false) {
    const M = this.mats;
    // Floor and rear bulkhead, so the cabin is not a lit-from-nowhere void.
    this._put(new THREE.BoxGeometry(halfW * 2.1, 0.06, 3.2), M.cabin, 0, floorY, deckZ - 1.6);
    // Seats, side by side up front and in rows behind.
    for (let r = 0; r < rows; r++) {
      for (const s of [1, -1]) {
        const sz = deckZ - r * 0.92;
        this._put(new THREE.BoxGeometry(0.46, 0.12, 0.48), M.leather, s * halfW * 0.52, floorY + 0.36, sz);
        const back = new THREE.BoxGeometry(0.46, 0.62, 0.12);
        this._put(back, M.leather, s * halfW * 0.52, floorY + 0.7, sz - 0.26, -0.14);
        this._put(new THREE.BoxGeometry(0.4, 0.16, 0.14), M.leather, s * halfW * 0.52, floorY + 1.02, sz - 0.3);
        this._put(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6), M.trim, s * halfW * 0.52, floorY + 0.18, sz);
      }
    }
    // Glareshield and instrument panel, faintly lit.
    const panel = new THREE.MeshStandardMaterial({
      color: 0x14171c, roughness: 0.85, emissive: 0x0d2230, emissiveIntensity: 0.9
    });
    this._put(new THREE.BoxGeometry(halfW * 1.9, 0.44, 0.1), panel, 0, floorY + 0.86, deckZ + 0.66, -0.22);
    this._put(new THREE.BoxGeometry(halfW * 2.0, 0.1, 0.26), M.cabin, 0, floorY + 1.1, deckZ + 0.62);
    // Screens on the panel.
    const scr = new THREE.MeshStandardMaterial({
      color: 0x0a1a16, emissive: 0x2ad0a0, emissiveIntensity: 0.8, roughness: 0.3
    });
    for (const dx of [-0.52, -0.18, 0.18, 0.52]) {
      this._put(new THREE.BoxGeometry(0.28, 0.2, 0.02), scr, dx * halfW, floorY + 0.88, deckZ + 0.62, -0.22);
    }
    // Centre pedestal with throttle levers.
    this._put(new THREE.BoxGeometry(0.22, 0.26, 0.6), M.cabin, 0, floorY + 0.5, deckZ + 0.2, 0.2);
    for (const dx of [-0.05, 0.05]) {
      this._put(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 5), M.chrome, dx, floorY + 0.7, deckZ + 0.22, 0.4);
      this._put(new THREE.SphereGeometry(0.035, 8, 6), M.trim, dx, floorY + 0.8, deckZ + 0.26);
    }
    // Controls: a yoke on a column, or a collective and cyclic in the heli.
    for (const s of [1, -1]) {
      if (stick) {
        this._put(new THREE.CylinderGeometry(0.02, 0.025, 0.46, 6), M.trim, s * halfW * 0.52, floorY + 0.55, deckZ + 0.26, 0.22);
        this._put(new THREE.BoxGeometry(0.07, 0.1, 0.06), M.trim, s * halfW * 0.52, floorY + 0.78, deckZ + 0.31);
        this._put(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), M.trim, s * halfW * 0.86, floorY + 0.42, deckZ - 0.12, 0, 0, 0.5);
      } else {
        this._put(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6), M.trim, s * halfW * 0.52, floorY + 0.7, deckZ + 0.4, 1.25);
        this._put(new THREE.TorusGeometry(0.13, 0.018, 6, 14, Math.PI * 1.35), M.trim,
          s * halfW * 0.52, floorY + 0.74, deckZ + 0.22, 0.32, 0, Math.PI);
      }
      // Rudder pedals.
      this._put(new THREE.BoxGeometry(0.1, 0.02, 0.16), M.trim, s * halfW * 0.52 - 0.1, floorY + 0.12, deckZ + 0.58, -0.3);
      this._put(new THREE.BoxGeometry(0.1, 0.02, 0.16), M.trim, s * halfW * 0.52 + 0.1, floorY + 0.12, deckZ + 0.58, -0.3);
    }
  }

  /**
   * Undercarriage. An oleo strut, a scissor link, a wheel with a real hub —
   * and, on the jet, a leg that folds into the belly after takeoff.
   */
  _legs(spec, wellY, retracts) {
    const M = this.mats;
    for (const g of spec) {
      const pivot = new THREE.Group();
      pivot.position.set(g.x, wellY, g.z);
      this.group.add(pivot);
      const drop = wellY - g.r;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, drop, 7), M.chrome);
      leg.position.y = -drop / 2;
      pivot.add(leg);
      // Oleo: a fatter lower section, and the scissor link across it.
      const oleo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, drop * 0.4, 6), M.trim);
      oleo.position.y = -drop * 0.78;
      pivot.add(oleo);
      const sc = new THREE.Mesh(new THREE.BoxGeometry(0.02, drop * 0.3, 0.05), M.trim);
      sc.position.set(0, -drop * 0.62, 0.07);
      sc.rotation.x = 0.35;
      pivot.add(sc);
      // Wheels: one, or a pair on the mains.
      const offs = g.twin ? [-0.12, 0.12] : [0];
      for (const ox of offs) {
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(g.r, g.r, 0.16, 14), M.rubber);
        tyre.rotation.z = Math.PI / 2;
        tyre.position.set(ox, -drop, 0);
        tyre.castShadow = true;
        pivot.add(tyre);
        const hubm = new THREE.Mesh(new THREE.CylinderGeometry(g.r * 0.52, g.r * 0.52, 0.18, 10), M.chrome);
        hubm.rotation.z = Math.PI / 2;
        hubm.position.set(ox, -drop, 0);
        pivot.add(hubm);
      }
      // Spats on fixed gear: the fairings a light aircraft wears over its
      // wheels, and half of what gives one its profile.
      if (!retracts && !g.nose) {
        const spat = new THREE.Mesh(loft([
          ellipseRing(10, 0.02, 0.02, { cy: -drop + g.r * 0.2, z: g.r * 1.25, n: 2.2 }),
          ellipseRing(10, 0.13, g.r * 0.85, { cy: -drop + g.r * 0.1, z: g.r * 0.35, n: 2.6 }),
          ellipseRing(10, 0.13, g.r * 0.8, { cy: -drop + g.r * 0.1, z: -g.r * 0.45, n: 2.6 }),
          ellipseRing(10, 0.02, 0.02, { cy: -drop + g.r * 0.2, z: -g.r * 1.2, n: 2.2 })
        ], { capStart: true, capEnd: true }), M.body);
        pivot.add(spat);
      }
      // Gear doors, hinged with the leg.
      if (retracts) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, drop * 0.75, 0.62), M.body);
        door.position.set(g.nose ? 0.13 : Math.sign(g.x) * 0.14, -drop * 0.45, 0);
        pivot.add(door);
      }
      this.gear.push({ pivot, axis: g.nose ? 'x' : 'z', sign: g.nose ? 1 : -Math.sign(g.x) || 1 });
    }
    this.retracts = retracts;
  }

  /**
   * The translucent disc a blade leaves behind once it's turning. Crisp blades
   * at 2000 RPM read as a toy windmill; a disc reads as a running engine.
   */
  _addBlur(parent, radius, y, z) {
    const mat = new THREE.MeshBasicMaterial({
      map: discTexture(), transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending
    });
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), mat);
    m.position.set(0, y, z);
    parent.add(m);
    this.blurs.push({ mesh: m, mat, parent });
  }

  // ------------------------------------------------------------- behaviour

  sync() {
    this.group.position.copy(this.position);
    // Nose toward +Z like every other vehicle, turned to face the way it's
    // flying. PITCH AND ROLL ARE NEGATED: with the body yawed a half turn, the
    // local X and Z axes point backwards relative to the world, so feeding
    // this.pitch in raw put the nose DOWN in a climb and dropped the wrong
    // wing in a turn. Every aeroplane in the city has been flying inverted in
    // attitude, which is exactly the sort of thing that reads as "floaty" long
    // before anyone can say why.
    this.group.rotation.set(-this.pitch, this.yaw + Math.PI, -this.roll, 'YXZ');
  }

  get playerDriven() { return this.driver === 'player'; }

  /** Drive the moving parts: surfaces, blades, blur, gear and lamps. */
  _animate(dt, pitchIn, yawIn) {
    const k = Math.min(1, dt * 6);
    const c = this.ctl;
    c.aileron += (yawIn - c.aileron) * k;
    c.elevator += (pitchIn - c.elevator) * k;
    c.rudder += (yawIn * 0.6 - c.rudder) * k;
    // Flaps come down when you're slow and near the ground, up when clean.
    const wantFlap = (!this.airborne || this.speed < this.type.rotateSpeed * 1.2) ? 1 : 0;
    c.flap += (wantFlap - c.flap) * Math.min(1, dt * 0.8);

    for (const { mesh, side } of this.surfaces.ail) mesh.rotation.x = c.aileron * 0.42 * side;
    for (const { mesh } of this.surfaces.elev) mesh.rotation.x = -c.elevator * 0.38;
    for (const { mesh } of this.surfaces.flap) mesh.rotation.x = c.flap * 0.5;
    if (this.surfaces.rudder) this.surfaces.rudder.rotation.y = c.rudder * 0.4;

    // Gear: down below 300 m and slow, up when you're away and climbing.
    if (this.retracts) {
      const want = (!this.airborne || this.position.y < 40) ? 1 : 0;
      this.gearT += (want - this.gearT) * Math.min(1, dt * 0.7);
      for (const g of this.gear) {
        const a = (1 - this.gearT) * (Math.PI / 2) * g.sign;
        if (g.axis === 'x') g.pivot.rotation.x = a;
        else g.pivot.rotation.z = a;
        g.pivot.visible = this.gearT > 0.02;
      }
    }

    // Blade blur: blades fade out as the disc fades in, crossing over at
    // roughly the speed the eye stops resolving them.
    const fade = THREE.MathUtils.clamp((this.rpm - 0.18) / 0.35, 0, 1);
    for (const b of this.blurs) {
      b.mat.opacity = fade * 0.85;
      b.mesh.visible = fade > 0.02;
    }
    if (this.blades) for (const ch of this.blades.children) {
      if (ch.material === this.mats.dark) ch.visible = fade < 0.92;
    }

    // Strobes and beacon: a double flash a second from the wingtips, a slow
    // sweep from the beacon. Free, and it makes a parked apron feel alive.
    this._t += dt;
    const ph = this._t % 1.4;
    this.lamps.strobe.emissiveIntensity = (ph < 0.06 || (ph > 0.16 && ph < 0.22)) ? 7 : 0.15;
    this.lamps.beacon.emissiveIntensity = 0.5 + 3.5 * Math.pow(Math.max(0, Math.sin(this._t * 3.2)), 8);
    const on = this.driver ? 1 : 0;
    this.lamps.land.emissiveIntensity = on ? (this.gearT > 0.5 ? 5 : 0.4) : 0.25;
  }

  /**
   * @param throttle -1..1
   * @param pitchIn  -1..1  (nose up positive)
   * @param yawIn    -1..1
   * @param lift     helicopters only: direct collective
   */
  fly(dt, throttle, pitchIn, yawIn, lift = 0) {
    const t = this.type;
    const heli = t.id === 'heli';

    // Thrust and drag along the body axis.
    this.speed += throttle * t.accel * dt;
    this.speed -= this.speed * t.drag * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -6, t.topSpeed);

    if (heli) {
      // Collective straight up, with a little forward tilt as it accelerates.
      this.vertical += (lift * 16 - this.vertical * 2.2) * dt;
      this.airborne = this.position.y > 0.4;
      this.pitch += (pitchIn * 0.4 - this.pitch) * dt * 2;
      this.roll += (yawIn * 0.5 - this.roll) * dt * 2.4;
      this.yaw -= yawIn * 1.2 * dt;
      this.rpm = Math.min(1, this.rpm + dt * 0.5);
      if (this.rotor) this.rotor.rotation.z += dt * 34 * this.rpm;
      // Rotor downwash: hover low over a park and the crowns flatten and
      // thrash under you, fading out as you climb away.
      const washK = this.rpm * Math.max(0, 1 - this.position.y / 42);
      if (washK > 0.03) WIND.wash(this.position.x, this.position.z, 24, washK * 1.7);
      if (this.tailRotor) this.tailRotor.rotation.z += dt * 46 * this.rpm;
    } else {
      // LIFT FROM AIRSPEED. Below rotate speed the controls do nothing and
      // the aircraft stays welded to the tarmac — that is the runway's whole
      // reason to exist.
      const airspeed = Math.max(0, this.speed);
      const canFly = airspeed > t.rotateSpeed * 0.62;
      if (canFly) {
        this.pitch += pitchIn * t.pitchRate * dt;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -0.75, 0.85);
        this.roll += (yawIn * 0.7 - this.roll) * dt * 2.2;
        this.yaw -= this.roll * t.rollRate * dt;
      } else {
        // On the ground: steer like a very heavy car, keep the nose level.
        this.yaw -= yawIn * 0.5 * dt * Math.min(1, airspeed / 12);
        this.pitch += (0 - this.pitch) * dt * 3;
        this.roll += (0 - this.roll) * dt * 3;
      }
      // Vertical speed: lift scales with airspeed over the rotate threshold,
      // and pitching up past what the speed supports simply bleeds it away.
      const liftAvail = (airspeed - t.rotateSpeed) / Math.max(1, t.rotateSpeed);
      this.vertical = Math.sin(this.pitch) * airspeed * THREE.MathUtils.clamp(liftAvail, -0.4, 1.0);
      if (this.pitch > 0.2 && liftAvail < 0.2) this.speed -= 9 * dt;   // mushing
      this.rpm = THREE.MathUtils.clamp(0.25 + airspeed / t.topSpeed, 0, 1);
      if (this.rotor) this.rotor.rotation.z += dt * (18 + airspeed * 0.6);
      if (this.fans) for (const f of this.fans) f.rotation.z += dt * (6 + airspeed * 0.5);
    }

    // Integrate.
    _fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), 0, -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.position.addScaledVector(_fwd, this.speed * dt);
    this.position.y += this.vertical * dt;

    // Gravity once airborne and unsupported.
    if (this.position.y > 0) {
      if (!heli) this.position.y -= 3.2 * dt;
      else this.position.y -= 4.5 * dt * (1 - Math.min(1, lift));
    }
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.vertical = 0;
      // Landing hard hurts.
      if (this.airborne && this.speed > t.rotateSpeed * 1.4) this.damage(24);
      this.airborne = false;
    } else {
      this.airborne = true;
    }
    // Keep it inside the world.
    const LIM = 2600;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -LIM, LIM);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -LIM, LIM);
    this.position.y = Math.min(this.position.y, 900);
    this._animate(dt, pitchIn, yawIn);
    this.sync();
  }

  /**
   * Parked aircraft still breathe: strobes flash and the beacon sweeps. The
   * apron was a row of dead ornaments without it.
   */
  idle(dt) {
    if (this.driver) return;
    this.rpm += (0 - this.rpm) * Math.min(1, dt * 0.8);
    if (this.rotor && this.rpm > 0.01) this.rotor.rotation.z += dt * 6 * this.rpm;
    this._animate(dt, 0, 0);
  }

  damage(n) {
    this.health -= n;
    if (this.health <= 0 && this.alive) {
      this.alive = false;
      const g = this.game;
      WIND.hit(this.position.x, this.position.z, 5);
      if (g.effects && g.effects.burst) {
        g.effects.burst(this.position.clone().setY(this.position.y + 1.5),
          { count: 60, color: 0xffa040, speed: 20, life: 1.2 });
      }
      if (g.audio && g.audio.explosion) g.audio.explosion();
    }
  }

  /** Same signature the cars use, so police fire and collisions reach here. */
  takeDamage(n) { this.damage(n); return n; }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}

export { TYPES as AIRCRAFT_TYPES };
