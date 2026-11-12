// Görsel efektler: lastik dumanı, fren izi, duvar kıvılcımı, hız şeridi alevi.
import * as THREE from 'three'
import type { CarSim } from '../sim/car'

const MAX_SMOKE = 260
const MAX_SPARK = 160
const MAX_SKID = 900 // dörtgen sayısı (halka tampon)

const pointsVS = `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const pointsFS = `
uniform vec3 uColor;
uniform float uSoft;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, uSoft, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`

class Pool {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  max: Float32Array
  alpha: Float32Array
  size: Float32Array
  grow: Float32Array
  geo = new THREE.BufferGeometry()
  points: THREE.Points
  next = 0
  constructor(
    public n: number,
    color: number,
    blending: THREE.Blending,
    soft: number,
  ) {
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.life = new Float32Array(n)
    this.max = new Float32Array(n).fill(1)
    this.alpha = new Float32Array(n)
    this.size = new Float32Array(n)
    this.grow = new Float32Array(n)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uSoft: { value: soft } },
      vertexShader: pointsVS,
      fragmentShader: pointsFS,
      transparent: true,
      depthWrite: false,
      blending,
    })
    this.points = new THREE.Points(this.geo, mat)
    this.points.frustumCulled = false
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow: number) {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.life[i] = life
    this.max[i] = life
    this.size[i] = size
    this.grow[i] = grow
  }
  update(dt: number, gravity: number, drag: number, fade: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        continue
      }
      this.life[i] -= dt
      const k = i * 3
      this.vel[k + 1] -= gravity * dt
      const d = Math.exp(-drag * dt)
      this.vel[k] *= d
      this.vel[k + 1] *= d
      this.vel[k + 2] *= d
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      this.size[i] += this.grow[i] * dt
      const t = Math.max(0, this.life[i] / this.max[i])
      this.alpha[i] = t * fade
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
  }
  clear() {
    this.life.fill(0)
    this.alpha.fill(0)
  }
}

export class Effects {
  group = new THREE.Group()
  private smoke: Pool
  private sparks: Pool
  private skidGeo = new THREE.BufferGeometry()
  private skidPos = new Float32Array(MAX_SKID * 6 * 3)
  private skidAlpha = new Float32Array(MAX_SKID * 6)
  private skidNext = 0
  private lastSkid: (THREE.Vector3 | null)[] = [null, null, null, null]
  private flames: THREE.Mesh[] = []
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private tmp3 = new THREE.Vector3()
  enabled = true

  constructor(lowPower: boolean) {
    this.smoke = new Pool(lowPower ? 120 : MAX_SMOKE, 0xe9e2f2, THREE.NormalBlending, 0.05)
    this.sparks = new Pool(lowPower ? 80 : MAX_SPARK, 0xffb347, THREE.AdditiveBlending, 0.2)
    this.group.add(this.smoke.points, this.sparks.points)

    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage))
    this.skidGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.skidAlpha, 1).setUsage(THREE.DynamicDrawUsage))
    const skidMat = new THREE.ShaderMaterial({
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(0.06,0.05,0.09, vA); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      side: THREE.DoubleSide,
    })
    const skid = new THREE.Mesh(this.skidGeo, skidMat)
    skid.frustumCulled = false
    this.group.add(skid)
  }

  /** hız şeridi alevi: araç grubuna eklenir */
  attachFlames(car: THREE.Object3D) {
    const geo = new THREE.ConeGeometry(0.22, 1.4, 7).rotateX(Math.PI / 2).translate(0, 0, 0.7)
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ffff0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    for (const x of [-0.45, 0.45]) {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, -0.25, 2.2)
      m.visible = false
      car.add(m)
      this.flames.push(m)
    }
  }

  reset() {
    this.smoke.clear()
    this.sparks.clear()
    this.skidAlpha.fill(0)
    this.skidGeo.attributes.aAlpha.needsUpdate = true
    this.lastSkid = [null, null, null, null]
  }

  update(car: CarSim, dt: number, boostActive: boolean) {
    const t = this.tmp
    const v = this.tmp2
    // alev
    const flick = 0.85 + Math.random() * 0.3
    for (const f of this.flames) {
      f.visible = boostActive
      f.scale.set(1, 1, flick * (boostActive ? 1.2 : 0))
    }
    if (!this.enabled) return
    // lastik: kayma ve drift
    const slipMag = Math.abs(car.slip)
    for (let k = 0; k < 4; k++) {
      const rear = k >= 2
      const sliding = car.wheelContact[k] && car.speed > 6 && (slipMag > (rear ? 4.5 : 6.5) || (car.drifting && rear))
      if (sliding) {
        car.wheelPoint(k, t)
        if (rear && Math.random() < Math.min(0.8, slipMag / 18 + (car.drifting ? 0.35 : 0))) {
          v.copy(car.up).multiplyScalar(1.5 + Math.random()).addScaledVector(car.v, 0.15)
          v.x += (Math.random() - 0.5) * 2
          v.z += (Math.random() - 0.5) * 2
          this.smoke.emit(t, v, 0.9 + Math.random() * 0.6, 1.2, 4.5)
        }
        this.addSkid(k, t, car.up, car.right)
      } else this.lastSkid[k] = null
    }
    // duvar kıvılcımı
    if (car.scrape > 0.4) {
      const n = Math.min(10, Math.round(car.scrape * 3))
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1
        t.copy(car.p).addScaledVector(car.right, side * 1.0).addScaledVector(car.f, (Math.random() - 0.5) * 3)
        v.copy(car.v).multiplyScalar(0.6).addScaledVector(car.up, 2 + Math.random() * 4)
        v.x += (Math.random() - 0.5) * 6
        v.z += (Math.random() - 0.5) * 6
        this.sparks.emit(t, v, 0.35 + Math.random() * 0.3, 0.35, -0.3)
      }
    }
    this.smoke.update(dt, -0.6, 1.2, 0.3)
    this.sparks.update(dt, 14, 0.5, 1)
    // izler yavaşça solar
    let dirty = false
    for (let i = 0; i < this.skidAlpha.length; i++) {
      if (this.skidAlpha[i] > 0) {
        this.skidAlpha[i] = Math.max(0, this.skidAlpha[i] - dt * 0.035)
        dirty = true
      }
    }
    if (dirty) this.skidGeo.attributes.aAlpha.needsUpdate = true
  }

  private addSkid(k: number, p: THREE.Vector3, up: THREE.Vector3, right: THREE.Vector3) {
    const prev = this.lastSkid[k]
    const cur = p.clone().addScaledVector(up, 0.03)
    if (!prev) {
      this.lastSkid[k] = cur
      return
    }
    if (prev.distanceToSquared(cur) < 0.25) return
    if (prev.distanceToSquared(cur) > 16) {
      this.lastSkid[k] = cur
      return
    }
    const w = 0.16
    const a = this.tmp3
    const pts = [
      a.copy(prev).addScaledVector(right, -w).clone(),
      a.copy(prev).addScaledVector(right, w).clone(),
      a.copy(cur).addScaledVector(right, w).clone(),
      a.copy(cur).addScaledVector(right, -w).clone(),
    ]
    const i = this.skidNext
    this.skidNext = (this.skidNext + 1) % MAX_SKID
    const order = [0, 1, 2, 0, 2, 3]
    order.forEach((o, j) => {
      this.skidPos.set([pts[o].x, pts[o].y, pts[o].z], (i * 6 + j) * 3)
      this.skidAlpha[i * 6 + j] = 0.55
    })
    this.skidGeo.attributes.position.needsUpdate = true
    this.skidGeo.attributes.aAlpha.needsUpdate = true
    this.lastSkid[k] = cur
  }
}
