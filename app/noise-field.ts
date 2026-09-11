import * as THREE from 'three';

// The signal-noise layer, ported from the jarvis-orb-ui orb and recoloured for
// this study: drifting code fragments, orbiting debris and near-field dust.
// The fragments orbit entirely in the vertex shader off a shared atlas, so all
// 1300 of them cost one draw call and nothing per frame on the CPU.
const FRAGMENTS = [
  'PACK 400V', '0xFF3A', 'CAN 0x2A1', '>> SCAN', 'SYNC OK', 'TORQUE', 'AWD LOCK', '01101001',
  'HV BUS', 'CELL 4416', 'yaw_rate', 'MOTOR R', 'MOTOR F', 'ACK', 'pack.tmp', '10110100',
  'RIDE 118', 'DAMP 0x4', 'ANGLE 26', 'MESH OK', 'TRI 775K', 'EDGE MAP', 'LOD 0', 'GLB LOAD',
  'IRQ 0x7', 'DRV READY', 'REGEN', 'SOC 98%', '12V AUX', 'PTC HEAT', 'CHILL 4C', 'FLOW 9L',
  'STEER 0.0', 'BRK 0 kPa', 'ABS OK', 'ESP OK', 'CAM FRONT', 'RADAR', 'SONIC 8', 'GPS LOCK',
  'FALCON L', 'FALCON R', 'SEAL OK', 'GLASS UV', 'TIRE 42psi', 'HUB 0x02', 'SPRING AIR', 'SHAFT CV',
];
const CELL_W = 256, CELL_H = 32, CENTER_Y = 1, SQUASH = .58;

function atlas() {
  const c = document.createElement('canvas'); c.width = CELL_W; c.height = CELL_H * FRAGMENTS.length;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.font = '500 15px "Chakra Petch","Courier New",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    FRAGMENTS.forEach((text, i) => ctx.fillText(text, CELL_W / 2, i * CELL_H + CELL_H / 2));
  }
  const texture = new THREE.CanvasTexture(c); texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  return texture;
}

// A radial falloff keeps dust reading as haze rather than as hard pixels.
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(190,255,228,1)'); g.addColorStop(.25, 'rgba(61,255,176,.55)'); g.addColorStop(.6, 'rgba(24,150,104,.12)'); g.addColorStop(1, 'rgba(0,60,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

type Orbit = { radius: number; speed: number; tiltX: number; tiltZ: number; phase: number; spinX: number; spinZ: number };
export type NoiseField = { node: THREE.Group; update(time: number, delta: number): void; dispose(): void };

export function createNoiseField(line: number, hot: number): NoiseField {
  const node = new THREE.Group(); node.name = 'noise';
  const map = atlas(), dotMap = dot();

  // ——— Drifting code fragments ———
  const shell = 900, ambient = 400, count = shell + ambient;
  const orbit = new Float32Array(count * 4), size = new Float32Array(count * 2), row = new Float32Array(count), alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const near = i < shell;
    const radius = near ? 2.9 + Math.random() * 1.7 : 5.4 + Math.random() * 7.5;
    const width = near ? .42 + Math.random() * .4 : .5 + Math.random() * .55;
    orbit.set([radius, Math.acos(2 * Math.random() - 1), (near ? .016 : .008) + Math.random() * (near ? .055 : .026) * (Math.random() > .5 ? 1 : -1), Math.random() * Math.PI * 2], i * 4);
    size.set([width, width * (CELL_H / CELL_W)], i * 2);
    row[i] = Math.floor(Math.random() * FRAGMENTS.length);
    alpha[i] = (near ? .3 : .13) + Math.random() * (near ? .6 : .28);
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const textGeometry = new THREE.InstancedBufferGeometry();
  textGeometry.index = quad.index;
  textGeometry.setAttribute('position', quad.attributes.position);
  textGeometry.setAttribute('uv', quad.attributes.uv);
  textGeometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  textGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  textGeometry.setAttribute('aRow', new THREE.InstancedBufferAttribute(row, 1));
  textGeometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
  textGeometry.instanceCount = count;
  const textMaterial = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uTime: { value: 0 }, uRows: { value: FRAGMENTS.length }, uColor: { value: new THREE.Color(line) }, uOpacity: { value: 1 } },
    vertexShader: `attribute vec4 aOrbit;attribute vec2 aSize;attribute float aRow;attribute float aAlpha;
uniform float uTime;uniform float uRows;varying vec2 vUv;varying float vAlpha;
void main(){
 float angle=aOrbit.w+uTime*aOrbit.z;float band=sin(aOrbit.y);
 vec3 centre=vec3(aOrbit.x*band*cos(angle),${CENTER_Y.toFixed(2)}+aOrbit.x*cos(aOrbit.y)*${SQUASH.toFixed(2)},aOrbit.x*band*sin(angle));
 vec4 view=modelViewMatrix*vec4(centre,1.0);
 view.xy+=position.xy*aSize;
 gl_Position=projectionMatrix*view;
 vUv=vec2(uv.x,(uv.y+aRow)/uRows);vAlpha=aAlpha;
}`,
    fragmentShader: `uniform sampler2D uMap;uniform vec3 uColor;uniform float uOpacity;varying vec2 vUv;varying float vAlpha;
void main(){
 float mask=texture2D(uMap,vUv).a;
 if(mask<0.02)discard;
 gl_FragColor=vec4(uColor,mask*vAlpha*uOpacity);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const text = new THREE.Mesh(textGeometry, textMaterial); text.frustumCulled = false; text.renderOrder = 3; text.raycast = () => { }; node.add(text);

  // ——— Orbiting debris ———
  const shapes = [new THREE.IcosahedronGeometry(.03, 0), new THREE.TetrahedronGeometry(.038, 0), new THREE.OctahedronGeometry(.024, 0)];
  const debrisMaterial = new THREE.MeshBasicMaterial({ color: line, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false });
  const debris: { mesh: THREE.InstancedMesh; orbits: Orbit[] }[] = shapes.map((geometry, index) => {
    const total = index === 0 ? 90 : 55;
    const mesh = new THREE.InstancedMesh(geometry, debrisMaterial, total);
    mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.raycast = () => { };
    const tint = new THREE.Color();
    const orbits = Array.from({ length: total }, (_, i) => {
      mesh.setColorAt(i, tint.setHex(Math.random() > .78 ? hot : line).multiplyScalar(.35 + Math.random() * .65));
      return { radius: 3.2 + Math.random() * 6.4, speed: (.06 + Math.random() * .42) * (Math.random() > .5 ? 1 : -1), tiltX: (Math.random() - .5) * Math.PI * .85, tiltZ: (Math.random() - .5) * Math.PI * .5, phase: Math.random() * Math.PI * 2, spinX: .4 + Math.random(), spinZ: .3 + Math.random() };
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    node.add(mesh);
    return { mesh, orbits };
  });
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Euler(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);

  // ——— Near-field dust ———
  const dustCount = 1500, dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const radius = 1.6 + Math.pow(Math.random(), .6) * 13, angle = Math.random() * Math.PI * 2, band = Math.acos(2 * Math.random() - 1);
    dustPositions.set([radius * Math.sin(band) * Math.cos(angle), CENTER_Y + radius * Math.cos(band) * SQUASH, radius * Math.sin(band) * Math.sin(angle)], i * 3);
  }
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsMaterial({ map: dotMap, color: line, size: .07, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const dust = new THREE.Points(dustGeometry, dustMaterial); dust.frustumCulled = false; dust.renderOrder = 3; dust.raycast = () => { }; node.add(dust);

  return {
    node,
    update(time, delta) {
      textMaterial.uniforms.uTime.value = time;
      for (const { mesh, orbits } of debris) {
        orbits.forEach((o, i) => {
          const angle = time * o.speed + o.phase;
          position.set(o.radius * Math.cos(angle) * Math.cos(o.tiltX), CENTER_Y + o.radius * Math.sin(o.tiltX) * Math.sin(angle * .8) * SQUASH + Math.sin(angle * .3 + o.tiltZ) * .2, o.radius * Math.sin(angle) * Math.cos(o.tiltZ));
          rotation.set(time * o.spinX, 0, time * o.spinZ);
          mesh.setMatrixAt(i, matrix.compose(position, quaternion.setFromEuler(rotation), scale));
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
      dust.rotation.y += delta * .012;
    },
    dispose() {
      textGeometry.dispose(); quad.dispose(); textMaterial.dispose(); map.dispose();
      shapes.forEach(g => g.dispose()); debrisMaterial.dispose(); debris.forEach(d => d.mesh.dispose());
      dustGeometry.dispose(); dustMaterial.dispose(); dotMap.dispose();
    },
  };
}
