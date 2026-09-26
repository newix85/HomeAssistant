// Pozemek: dům dole pod kopcem, za ním stoupá svah (sever). Po stranách pozemku
// vede plot do kopce, na něm FVE východ (HMS-2000 left) a západ (HMS-2000 right).
// Na vrcholu altán s vířivkou, FVE na jeho střeše (Anenji) a baterie vedle.
// Vpředu sloup s přípojkou 3 fází (Shelly EM3), na jižní střeše domu FVE (Solax).
// Souřadnice: sever = -z (do kopce), jih = +z (ke kameře), východ = +x.
// Dům 12 × 8 m ve středu, přízemí na úrovni y = 0.

import * as THREE from 'three';

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Kopec za domem
// (musí klesnout na 0 uvnitř jemné mřížky terénu ve scene.js: x ±60, z −80…40)
const HILL = { height: 7, riseFrom: -6, riseTo: -24, fallFrom: -52, fallTo: -77, halfWidth: 30, edge: 25 };

/** Výška terénu v bodě (x, z). Rovina kolem domu, za ním svah a plató na vrcholu. */
export function terrainHeight(x, z) {
  const up = smoothstep(HILL.riseFrom, HILL.riseTo, z);             // svah za domem
  const down = 1 - smoothstep(HILL.fallFrom, HILL.fallTo, z);       // daleko za vrcholem zase dolů
  const side = 1 - smoothstep(HILL.halfWidth, HILL.halfWidth + HILL.edge, Math.abs(x));
  return HILL.height * up * down * side;
}

// Pozemek (plot): od přední strany až na vrchol kopce
const PLOT = { west: -16, east: 16, north: -36, south: 12, gate: [-2, 2] };
const ALTAN = { x: 2, z: -29 };

const PANEL_COLOR = new THREE.Color('#1d2b4a');
const PANEL_GLOW = new THREE.Color('#58b4ff');
const PHASE_IDLE = new THREE.Color('#6d7580');
const PHASE_LOAD = new THREE.Color('#ff9a3c');
const PHASE_EXPORT = new THREE.Color('#5fd38a');
const PHASE_FULL_W = 3000; // plná barva při 3 kW na fázi

const quantize = (x, step) => Math.round(x / step) * step;

function panelMaterial() {
  return new THREE.MeshLambertMaterial({ color: PANEL_COLOR, emissive: new THREE.Color('#000000') });
}

/** Instancované objekty: jeden draw call na skupinu. placements: { position, rotation?, scale? } */
function instanced(geometry, material, placements) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  placements.forEach(({ position, rotation, scale, lookAt }, i) => {
    dummy.position.copy(position);
    dummy.rotation.copy(rotation ?? new THREE.Euler());
    if (lookAt) dummy.lookAt(lookAt);
    dummy.scale.copy(scale ?? new THREE.Vector3(1, 1, 1));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  return mesh;
}

export class Property {
  constructor() {
    this.group = new THREE.Group();
    /** Body v prostoru pro štítky (HTML) */
    this.anchors = {};
    this.pvMaterials = {
      house: panelMaterial(), east: panelMaterial(), west: panelMaterial(), terrace: panelMaterial(),
    };
    this.lastEnergyKey = '';

    this.#buildRoofPv();
    this.#buildFence();
    this.#buildAltan();
    this.#buildGridConnection();
  }

  #buildRoofPv() {
    // Jižní střešní rovina: od hřebene (y 9.4, z 0) k okapu (y 6, z 4.6)
    const tilt = Math.atan2(3.4, 4.6);
    const down = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt)); // po spádu dolů
    const normal = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const ridge = new THREE.Vector3(0, 9.4, 0);
    const placements = [];
    for (const s of [1.1, 2.25, 3.4]) {           // vzdálenost od hřebene po spádu
      for (const x of [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5]) {
        const p = ridge.clone().addScaledVector(down, s).addScaledVector(normal, 0.08);
        p.x = x;
        placements.push({ position: p, rotation: new THREE.Euler(tilt, 0, 0) });
      }
    }
    this.group.add(instanced(new THREE.BoxGeometry(1.7, 0.06, 1.05), this.pvMaterials.house, placements));
    this.anchors.pvHouse = new THREE.Vector3(0, 9.8, 2.2);
  }

  #buildFence() {
    const wood = lambert('#8a6a4a');
    const { west, east, north, south, gate } = PLOT;
    const ground = (x, z, dy) => new THREE.Vector3(x, terrainHeight(x, z) + dy, z);
    const posts = [];
    const rails = [];

    // Strana plotu = řada sloupků po terénu; latě spojují sousední sloupky
    const side = (x1, z1, x2, z2) => {
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 2.5));
      const points = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        points.push([x, z, x > gate[0] && x < gate[1] && z === south]);
      }
      points.forEach(([x, z, inGate]) => { if (!inGate) posts.push({ position: ground(x, z, 0.7) }); });
      for (let i = 0; i < n; i++) {
        const [xa, za, ga] = points[i], [xb, zb, gb] = points[i + 1];
        if (ga || gb) continue; // branka
        for (const dy of [0.45, 1.2]) {
          const a = ground(xa, za, dy), b = ground(xb, zb, dy);
          rails.push({
            position: a.clone().lerp(b, 0.5), lookAt: b, scale: new THREE.Vector3(1, 1, a.distanceTo(b)),
          });
        }
      }
    };
    side(west, south, east, south);
    side(east, south, east, north);
    side(east, north, west, north);
    side(west, north, west, south);

    this.group.add(instanced(new THREE.BoxGeometry(0.15, 1.4, 0.15), wood, posts));
    this.group.add(instanced(new THREE.BoxGeometry(0.06, 0.08, 1), wood, rails));

    // FVE na plotu do kopce: 4 svislé panely na každé straně (HMS-2000 = 4 panely)
    const panelGeo = new THREE.BoxGeometry(0.06, 1.7, 1.05);
    const fencePanels = (x) => [-9, -10.2, -11.4, -12.6].map((z) => ({ position: ground(x, z, 1.05) }));
    this.group.add(instanced(panelGeo, this.pvMaterials.east, fencePanels(east + 0.12)));
    this.group.add(instanced(panelGeo, this.pvMaterials.west, fencePanels(west - 0.12)));
    this.anchors.pvEast = ground(east, -10.8, 2.6);
    this.anchors.pvWest = ground(west, -10.8, 2.6);
  }

  #buildAltan() {
    // Altán na vrcholu kopce: podlaha, sloupky, střecha s FVE, uvnitř vířivka
    const { x: cx, z: cz } = ALTAN;
    const base = terrainHeight(cx, cz);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 6), lambert('#b08a62'));
    floor.position.set(cx, base + 0.15, cz);
    this.group.add(floor);

    const posts = [[-3.2, -2.7], [3.2, -2.7], [-3.2, 2.7], [3.2, 2.7]]
      .map(([dx, dz]) => ({ position: new THREE.Vector3(cx + dx, base + 1.6, cz + dz) }));
    this.group.add(instanced(new THREE.BoxGeometry(0.2, 2.6, 0.2), lambert('#6b5038'), posts));

    const tub = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.9, 20), lambert('#e9e4da'));
    tub.position.set(cx, base + 0.75, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: '#63c7e0' }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, base + 1.21, cz);
    this.group.add(tub, water);

    // Střecha z panelů, mírně skloněná k jihu (ke kameře)
    const tilt = THREE.MathUtils.degToRad(10);
    const roofPanels = [];
    for (const dz of [-2.3, -1.15, 0, 1.15, 2.3]) {
      for (const dx of [-2.3, -0.8, 0.7, 2.2]) {
        roofPanels.push({
          position: new THREE.Vector3(cx + dx, base + 3.1 - dz * Math.tan(tilt), cz + dz),
          rotation: new THREE.Euler(tilt, 0, 0),
        });
      }
    }
    this.group.add(instanced(new THREE.BoxGeometry(1.45, 0.06, 1.1), this.pvMaterials.terrace, roofPanels));
    this.anchors.pvTerrace = new THREE.Vector3(cx, base + 4.2, cz);

    // Baterie vedle altánu: skříňka s ukazatelem nabití na přední (jižní) straně
    const bx = cx + 4.6, bz = cz + 2;
    const bBase = terrainHeight(bx, bz);
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.5), lambert('#d8dde3'));
    cabinet.position.set(bx, bBase + 0.65, bz);
    this.group.add(cabinet);
    this.socBarMaterial = new THREE.MeshBasicMaterial({ color: '#5fd38a' });
    this.socBar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1), this.socBarMaterial);
    this.socBarBase = bBase + 0.15; // spodní okraj ukazatele (y)
    this.socBar.position.set(bx, bBase + 0.6, bz + 0.26);
    this.group.add(this.socBar);
    this.anchors.battery = new THREE.Vector3(bx + 0.6, bBase + 1.8, bz);
  }

  #buildGridConnection() {
    // Sloup vpředu za plotem, tři kabely do přípojkové skříně na přední stěně domu
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8.5, 8), lambert('#7a6a58'));
    pole.position.set(-5, 4.25, 17);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), lambert('#7a6a58'));
    arm.position.set(-5, 8.1, 17);
    this.group.add(pole, arm);

    this.phaseMaterials = [];
    [-0.6, 0, 0.6].forEach((dx, i) => {
      const start = new THREE.Vector3(-5 + dx, 8.1, 17);
      const end = new THREE.Vector3(-3.5 + dx * 0.5, 4.95 - i * 0.25, 4.15);
      const mid = start.clone().lerp(end, 0.5);
      mid.y -= 1.3; // průvěs
      const material = new THREE.MeshBasicMaterial({ color: PHASE_IDLE.clone() });
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 24, 0.07, 5),
        material,
      );
      this.phaseMaterials.push(material);
      this.group.add(tube);
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.2), lambert('#cfd4da'));
    box.position.set(-3.5, 4.7, 4.1);
    this.group.add(box);
    this.anchors.phases = new THREE.Vector3(-5, 9.6, 17);
  }

  /**
   * Obarví panely podle výroby, kabely podle odběru a ukazatel baterie.
   * @param {{ pv: Record<string, number|null>, phasesW: (number|null)[], soc: number|null }} energy
   *   pv = podíl výkonu 0–1 (null = neznámo), phasesW = výkon fáze ve W (záporný = dodávka)
   * @returns {boolean} true, když se něco viditelně změnilo (je třeba překreslit)
   */
  setEnergy({ pv, phasesW, soc }) {
    const key = JSON.stringify([
      Object.values(pv).map((r) => (r === null ? null : quantize(r, 0.05))),
      phasesW.map((w) => (w === null ? null : quantize(w, 100))),
      soc === null ? null : quantize(soc, 5),
    ]);
    if (key === this.lastEnergyKey) return false;
    this.lastEnergyKey = key;

    for (const [name, ratio] of Object.entries(pv)) {
      const material = this.pvMaterials[name];
      if (!material) continue;
      const r = Math.min(Math.max(ratio ?? 0, 0), 1);
      material.emissive.copy(PANEL_GLOW).multiplyScalar(0.08 + 0.7 * r);
      if (ratio === null) material.emissive.setScalar(0);
    }

    phasesW.forEach((w, i) => {
      const material = this.phaseMaterials[i];
      if (w === null) { material.color.copy(PHASE_IDLE); return; }
      const target = w < 0 ? PHASE_EXPORT : PHASE_LOAD;
      material.color.copy(PHASE_IDLE).lerp(target, Math.min(Math.abs(w) / PHASE_FULL_W, 1) * 0.85 + 0.15);
    });

    const level = soc === null ? 0 : Math.min(Math.max(soc, 0), 100) / 100;
    this.socBar.visible = soc !== null;
    this.socBar.scale.y = Math.max(level, 0.02) * 0.9;
    this.socBar.position.y = this.socBarBase + (this.socBar.scale.y / 2);
    this.socBarMaterial.color.set(level < 0.2 ? '#ef6a5b' : level < 0.5 ? '#f2b84b' : '#5fd38a');
    return true;
  }
}
