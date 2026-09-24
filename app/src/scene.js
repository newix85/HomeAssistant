// 3D scéna pohledu Dům: low-poly dům, zahrada, obloha podle polohy slunce.
// Kreslí se jen na vyžádání (requestRender), žádná trvalá smyčka.

import * as THREE from 'three';

// Barvy oblohy [zenit, horizont] podle výšky slunce nad obzorem (°)
const SKY_KEYS = [
  { el: -18, top: '#03060f', bottom: '#0a1426' },
  { el: -6, top: '#0f1d3f', bottom: '#3b3f6b' },
  { el: 0, top: '#2a4378', bottom: '#e39a72' },
  { el: 8, top: '#3a6fb8', bottom: '#f6cf9a' },
  { el: 25, top: '#2f7fe0', bottom: '#cfe6ff' },
];
const CLOUD_TOP = new THREE.Color('#8a96a6');
const CLOUD_BOTTOM = new THREE.Color('#c3c9d1');

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function skyColors(elevation) {
  const keys = SKY_KEYS;
  if (elevation <= keys[0].el) return [new THREE.Color(keys[0].top), new THREE.Color(keys[0].bottom)];
  for (let i = 1; i < keys.length; i++) {
    if (elevation <= keys[i].el) {
      const t = (elevation - keys[i - 1].el) / (keys[i].el - keys[i - 1].el);
      return [
        new THREE.Color(keys[i - 1].top).lerp(new THREE.Color(keys[i].top), t),
        new THREE.Color(keys[i - 1].bottom).lerp(new THREE.Color(keys[i].bottom), t),
      ];
    }
  }
  const last = keys.at(-1);
  return [new THREE.Color(last.top), new THREE.Color(last.bottom)];
}

/** Směr ke slunci: azimut od severu po směru hodinek; sever = -z, východ = +x. */
function sunDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export class HouseScene {
  constructor(container, { renderScale = 0.75 } = {}) {
    this.renderScale = renderScale;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.error('WebGL context lost, obnovuji stránku');
      setTimeout(() => location.reload(), 2000);
    });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#cfe6ff', 70, 330);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
    this.camera.position.set(30, 13, 34);
    this.camera.lookAt(0, 3.5, 0);

    this.#buildSky();
    this.#buildLights();
    this.#buildGround();
    this.#buildHouse();
    this.#buildTrees();

    this.renderPending = false;
    addEventListener('resize', () => this.#resize());
    this.#resize();
    this.setEnvironment({ elevation: 30, azimuth: 180, cloudiness: 0 });
  }

  #buildSky() {
    this.skyUniforms = {
      top: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
    };
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: this.skyUniforms,
        vertexShader: `varying float h;
          void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float h;
          void main() {
            gl_FragColor = vec4(mix(bottom, top, clamp(h * 1.8, 0.0, 1.0)), 1.0);
            #include <colorspace_fragment>
          }`, // barvy jsou lineární, výstup musí do sRGB jako u ostatních materiálů
      }),
    ));

    // Hvězdy: jeden draw call, viditelné jen v noci
    const count = 400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // pseudonáhodně, ale deterministicky (stejná obloha po restartu)
      const u = ((i * 0.618034) % 1), v = ((i * 0.754877) % 1);
      const theta = u * Math.PI * 2, y = 0.08 + v * 0.92;
      const r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(theta) * r * 380, y * 380, Math.sin(theta) * r * 380], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: '#dfe8ff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false,
    }));
    this.scene.add(this.stars);

    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: '#fff3d6', fog: false }));
    this.scene.add(this.sunDisc);
  }

  #buildLights() {
    this.hemi = new THREE.HemisphereLight('#dfefff', '#4a6b3a', 1.5);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.8);
    this.scene.add(this.hemi, this.sun);
  }

  #buildGround() {
    // Zem sahá skoro k obloze a mlha v barvě obzoru skryje její okraj
    const ground = new THREE.Mesh(new THREE.CircleGeometry(380, 48), lambert('#7fae5a'));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  #buildHouse() {
    const house = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 8), lambert('#f1ede4'));
    body.position.y = 3;

    const roofShape = new THREE.Shape([
      new THREE.Vector2(-4.6, 0), new THREE.Vector2(4.6, 0), new THREE.Vector2(0, 3.4),
    ]);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 13, bevelEnabled: false });
    roofGeo.translate(0, 0, -6.5);
    const roof = new THREE.Mesh(roofGeo, lambert('#b5533c'));
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 6;

    this.windowMaterial = new THREE.MeshBasicMaterial({ color: '#9fb8c8' });
    const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.6, 0.2), this.windowMaterial, 8);
    const m = new THREE.Matrix4();
    [-4, -1.3, 1.3, 4].forEach((x, i) => {
      windows.setMatrixAt(i, m.makeTranslation(x, 3.5, 4.05));
      windows.setMatrixAt(i + 4, m.makeTranslation(x, 3.5, -4.05));
    });

    house.add(body, roof, windows);
    this.scene.add(house);
  }

  #buildTrees() {
    const count = 24;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), lambert('#6b4a2f'), count);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4, 7), lambert('#3f7d3a'), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 3) * 0.3;
      const r = 20 + ((i * 37) % 30);
      const s = 0.7 + ((i * 13) % 10) / 15;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const scale = new THREE.Vector3(s, s, s);
      trunks.setMatrixAt(i, m.compose(new THREE.Vector3(x, s, z), q, scale));
      crowns.setMatrixAt(i, m.compose(new THREE.Vector3(x, 3.8 * s, z), q, scale));
    }
    this.scene.add(trunks, crowns);
  }

  #resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(this.renderScale * Math.min(devicePixelRatio, 1));
    this.renderer.setSize(w, h, false);
    Object.assign(this.renderer.domElement.style, { width: `${w}px`, height: `${h}px` });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /**
   * Nastaví oblohu a světlo.
   * @param {{ elevation: number, azimuth: number, cloudiness: number }} env
   */
  setEnvironment({ elevation, azimuth, cloudiness }) {
    const [top, bottom] = skyColors(elevation);
    const clouds = cloudiness * smoothstep(-8, 5, elevation); // v noci mraky nerozlišujeme
    this.skyUniforms.top.value.copy(top.lerp(CLOUD_TOP, clouds * 0.7));
    this.skyUniforms.bottom.value.copy(bottom.lerp(CLOUD_BOTTOM, clouds * 0.6));
    this.scene.fog.color.copy(this.skyUniforms.bottom.value);

    const dir = sunDirection(azimuth, elevation);
    const daylight = smoothstep(-4, 20, elevation);
    this.sun.position.copy(dir).multiplyScalar(60);
    this.sun.intensity = 1.9 * daylight * (1 - clouds * 0.6);
    this.hemi.intensity = 0.25 + 1.25 * smoothstep(-10, 15, elevation);

    this.sunDisc.visible = elevation > -1 && clouds < 0.75;
    this.sunDisc.position.copy(dir).multiplyScalar(360);
    this.sunDisc.lookAt(0, 0, 0);

    this.stars.material.opacity = 1 - smoothstep(-12, -4, elevation);
    this.stars.visible = this.stars.material.opacity > 0.01;

    // Okna v noci svítí, přes den odrážejí oblohu
    this.windowMaterial.color.set(elevation < -2 ? '#ffd98a' : '#9fb8c8');
    this.requestRender();
  }

  requestRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}
