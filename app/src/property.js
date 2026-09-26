// Pozemek kolem domu: FVE na střeše, plot s FVE (východ/západ), terasa s vířivkou
// a pergolou s FVE, baterie terasy, přípojka 3 fází ze sloupu.
// Souřadnice: sever = -z (vzadu), jih = +z (vpředu), východ = +x. Dům 12 × 8 m ve středu.

import * as THREE from 'three';

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// Plot: obdélník kolem domu
const PLOT = { west: -16, east: 16, north: -18, south: 12 };

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

/** Instancované panely: jeden draw call na pole FVE. */
function panelArray(geometry, material, placements) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  placements.forEach(({ position, rotation }, i) => {
    dummy.position.copy(position);
    dummy.rotation.copy(rotation ?? new THREE.Euler());
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
    this.#buildTerrace();
    this.#buildGridConnection();
  }

  #buildRoofPv() {
    // Jižní střešní rovina: od okapu (y 6, z 4.6) k hřebeni (y 9.4, z 0)
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
    this.group.add(panelArray(new THREE.BoxGeometry(1.7, 0.06, 1.05), this.pvMaterials.house, placements));
    this.anchors.pvHouse = new THREE.Vector3(0, 9.8, 2.2);
  }

  #buildFence() {
    const wood = lambert('#8a6a4a');
    const { west, east, north, south } = PLOT;
    const posts = [];
    const rails = [];
    const side = (x1, z1, x2, z2, gapFrom = null, gapTo = null) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.round(len / 2.5);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        if (gapFrom !== null && x > gapFrom && x < gapTo) continue;
        posts.push(new THREE.Vector3(x, 0.7, z));
      }
      rails.push({ x1, z1, x2, z2, gapFrom, gapTo });
    };
    side(west, south, east, south, -2, 2);   // vpředu branka
    side(east, south, east, north);
    side(east, north, west, north);
    side(west, north, west, south);

    this.group.add(panelArray(
      new THREE.BoxGeometry(0.15, 1.4, 0.15), wood, posts.map((position) => ({ position })),
    ));

    const railGeo = new THREE.BoxGeometry(1, 0.08, 0.06);
    const railPlacements = [];
    for (const { x1, z1, x2, z2, gapFrom, gapTo } of rails) {
      const segments = gapFrom === null ? [[x1, x2]] : [[x1, gapFrom], [gapTo, x2]];
      for (const [a, b] of segments) {
        const len = Math.hypot(b - a, z2 - z1);
        const cx = (a + b) / 2, cz = (z1 + z2) / 2;
        const angle = Math.atan2(-(z2 - z1), b - a);
        for (const y of [0.45, 1.2]) {
          railPlacements.push({ position: new THREE.Vector3(cx, y, cz), rotation: new THREE.Euler(0, angle, 0), len });
        }
      }
    }
    const railMesh = new THREE.InstancedMesh(railGeo, wood, railPlacements.length);
    const dummy = new THREE.Object3D();
    railPlacements.forEach(({ position, rotation, len }, i) => {
      dummy.position.copy(position);
      dummy.rotation.copy(rotation);
      dummy.scale.set(len, 1, 1);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    });
    this.group.add(railMesh);

    // FVE na plotu: 4 svislé panely na každé straně (HMS-2000 = 4 panely)
    const panelGeo = new THREE.BoxGeometry(0.06, 1.7, 1.05);
    const fencePanels = (x) => [3.2, 4.4, 5.6, 6.8].map((z) => ({
      position: new THREE.Vector3(x, 1.05, z),
    }));
    this.group.add(panelArray(panelGeo, this.pvMaterials.east, fencePanels(east + 0.12)));
    this.group.add(panelArray(panelGeo, this.pvMaterials.west, fencePanels(west - 0.12)));
    this.anchors.pvEast = new THREE.Vector3(east, 2.4, 5);
    this.anchors.pvWest = new THREE.Vector3(west, 2.4, 5);
  }

  #buildTerrace() {
    // Terasa za domem (dům končí na z = -4)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 8), lambert('#b08a62'));
    deck.position.set(0, 0.15, -8.2);
    this.group.add(deck);

    // Vířivka
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.9, 20), lambert('#e9e4da'));
    tub.position.set(3.6, 0.75, -8.4);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: '#63c7e0' }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(3.6, 1.21, -8.4);
    this.group.add(tub, water);

    // Pergola s FVE střechou (Anenji)
    const postGeo = new THREE.BoxGeometry(0.18, 2.6, 0.18);
    const postMat = lambert('#6b5038');
    const pergolaPosts = [[0.4, -5.2], [6.6, -5.2], [0.4, -11.2], [6.6, -11.2]]
      .map(([x, z]) => ({ position: new THREE.Vector3(x, 1.6, z) }));
    this.group.add(panelArray(postGeo, postMat, pergolaPosts));

    const tilt = THREE.MathUtils.degToRad(8); // mírný sklon k jihu
    const roofPanels = [];
    for (const z of [-10.4, -9.3, -8.2, -7.1, -6.0]) {
      for (const x of [1.2, 2.7, 4.2, 5.7]) {
        roofPanels.push({ position: new THREE.Vector3(x, 2.95 + (z + 8.2) * -0.07, z), rotation: new THREE.Euler(tilt, 0, 0) });
      }
    }
    this.group.add(panelArray(new THREE.BoxGeometry(1.45, 0.06, 1.05), this.pvMaterials.terrace, roofPanels));
    this.anchors.pvTerrace = new THREE.Vector3(3.5, 3.6, -8.2);

    // Baterie terasy: skříňka s ukazatelem nabití na přední straně
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.5), lambert('#d8dde3'));
    cabinet.position.set(8, 0.65, -6.2);
    this.group.add(cabinet);
    this.socBarMaterial = new THREE.MeshBasicMaterial({ color: '#5fd38a' });
    this.socBar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1), this.socBarMaterial);
    this.socBarBase = 0.15; // spodní okraj ukazatele (y)
    this.socBar.position.set(8, 0.6, -5.94);
    this.group.add(this.socBar);
    this.anchors.battery = new THREE.Vector3(8, 1.7, -6.2);
  }

  #buildGridConnection() {
    // Sloup vpředu za plotem, tři kabely do přípojkové skříně na přední stěně
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
