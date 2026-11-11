// Üç boyutlu dünya: gökyüzü, kanyon zemini, pist şeridi, kapılar, kamera.
import * as THREE from 'three'
import { Track } from '../sim/track'

export const PALETTE = {
  skyTop: 0x5b4b8a,
  skyHorizon: 0xffc59e,
  fog: 0xf4b896,
  sun: 0xfff0d6,
  road: 0x2e2a45,
  road2: 0x34304d,
  edge: 0xfff1dc,
  curb: 0xff6b5b,
  wall: 0xf7e6cf,
  wallTop: 0xff8a5c,
  under: 0x4a3d5c,
  pillar: 0xd9b99b,
  boost: 0x37e0d0,
  cp: 0x9ef06b,
  sand: 0xe8b07f,
  clay: 0xc9785a,
  rock: 0x9b5a63,
  shrub: 0x7f9a6a,
}

export interface Settings {
  reducedMotion: boolean
  lowPower: boolean
}

export class World {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  trackGroup = new THREE.Group()
  track?: Track
  private camUp = new THREE.Vector3(0, 1, 0)
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private camInit = false
  shake = 0

  constructor(
    public canvas: HTMLCanvasElement,
    public settings: Settings,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !settings.lowPower, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.lowPower ? 1.25 : 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.3, 2600)
    this.scene.fog = new THREE.Fog(PALETTE.fog, 180, 1500)
    this.scene.add(this.makeSky())

    const hemi = new THREE.HemisphereLight(0xffe2c9, 0xc98f86, 1.5)
    this.scene.add(hemi)
    // alttan dolgu: döngüde ve duvarda ters dönen yol simsiyah kalmasın
    const fill = new THREE.DirectionalLight(0xffc4a3, 1.6)
    fill.position.set(30, -100, 40)
    this.scene.add(fill)
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.4)
    this.sun.castShadow = true
    const sm = settings.lowPower ? 1024 : 2048
    this.sun.shadow.mapSize.set(sm, sm)
    const sc = this.sun.shadow.camera
    sc.left = -40
    sc.right = 40
    sc.top = 40
    sc.bottom = -40
    sc.near = 1
    sc.far = 300
    this.sun.shadow.bias = -0.0006
    this.scene.add(this.sun, this.sun.target)
    this.scene.add(this.trackGroup)
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // dikey ekranda görüş alanını genişlet
    this.camera.fov = w < h ? 82 : 68
    this.camera.updateProjectionMatrix()
  }

  private makeSky() {
    const geo = new THREE.SphereGeometry(2400, 24, 12)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        sunDir: { value: new THREE.Vector3(-0.5, 0.28, -0.8).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0,0.86,0.6) * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.25);
          if (h < 0.0) c = mix(horizon, vec3(0.86,0.55,0.45), clamp(-h*4.0,0.0,1.0));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    const m = new THREE.Mesh(geo, mat)
    m.frustumCulled = false
    m.renderOrder = -1
    return m
  }

  /** Pist ve çevreyi kur (öncekini temizler) */
  setTrack(track: Track) {
    this.clearTrack()
    this.track = track
    const g = this.trackGroup
    g.add(buildRoad(track))
    const boost = buildBoost(track)
    if (boost) g.add(boost)
    g.add(buildGates(track))
    g.add(buildPillars(track))
    g.add(buildScenery(track, this.settings.lowPower))
    this.camInit = false
  }

  clearTrack() {
    const g = this.trackGroup
    g.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
        const mm = x as THREE.MeshBasicMaterial
        mm.map?.dispose()
        x.dispose()
      })
    })
    g.clear()
  }

  /** takip kamerası */
  follow(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3, vel: THREE.Vector3, grounded: boolean, dt: number) {
    const rm = this.settings.reducedMotion
    const speed = vel.length()
    const dir = tmpA.copy(fwd)
    if (speed > 6) dir.lerp(tmpB.copy(vel).normalize(), 0.35).normalize()
    const targetUp = grounded ? up : tmpC.set(0, 1, 0)
    this.camUp.lerp(targetUp, 1 - Math.exp(-(grounded ? 4 : 1.5) * dt)).normalize()
    const portrait = this.camera.aspect < 1
    const dist = (portrait ? 8.6 : 7.6) + Math.min(speed, 80) * 0.03
    const height = portrait ? 4.2 : 2.7
    const want = tmpD.copy(pos).addScaledVector(dir, -dist).addScaledVector(this.camUp, height)
    const look = tmpE.copy(pos).addScaledVector(dir, portrait ? 12 : 6).addScaledVector(this.camUp, portrait ? 0.8 : 1.3)
    if (!this.camInit) {
      this.camPos.copy(want)
      this.camLook.copy(look)
      this.camInit = true
    }
    const k = 1 - Math.exp(-(rm ? 6 : 9) * dt)
    this.camPos.lerp(want, k)
    this.camLook.lerp(look, 1 - Math.exp(-14 * dt))
    this.camera.position.copy(this.camPos)
    if (!rm && this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake
      this.shake = Math.max(0, this.shake - dt * 2.5)
    }
    this.camera.up.copy(this.camUp)
    this.camera.lookAt(this.camLook)
    const baseFov = this.camera.aspect < 1 ? 82 : 68
    const fov = rm ? baseFov : baseFov + Math.min(14, Math.max(0, speed - 25) * 0.28)
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4)
      this.camera.updateProjectionMatrix()
    }
    this.placeSun(pos)
  }

  /** menü arka planı: pistin üstünde yavaş tur */
  orbit(t: number) {
    const tr = this.track
    if (!tr) return
    const b = tr.bounds
    const cx = (b.minX + b.maxX) / 2,
      cz = (b.minZ + b.maxZ) / 2
    const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.55 + 90
    const a = this.settings.reducedMotion ? 0.6 : t * 0.05
    this.camera.position.set(cx + Math.cos(a) * r, tr.maxY + 70 + r * 0.18, cz + Math.sin(a) * r)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(cx, (tr.minY + tr.maxY) / 2, cz)
    this.placeSun(tmpA.set(cx, tr.minY, cz), r + 60)
    this.camInit = false
  }

  private placeSun(at: THREE.Vector3, size = 40) {
    this.sun.position.copy(at).add(tmpB.set(-60, 110, -90))
    this.sun.target.position.copy(at)
    const sc = this.sun.shadow.camera
    if (sc.right !== size) {
      sc.left = -size
      sc.right = size
      sc.top = size
      sc.bottom = -size
      sc.far = 300 + size * 2
      sc.updateProjectionMatrix()
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpD = new THREE.Vector3()
const tmpE = new THREE.Vector3()

// ---------------------------------------------------------------- pist geometrisi

/** Çizim için sadeleştirilmiş örnek listesi */
function pickSamples(tr: Track): number[] {
  const out: number[] = [0]
  let last = 0
  for (let i = 1; i < tr.count; i++) {
    const end = i === tr.count - 1
    const flag =
      tr.surface[i] !== tr.surface[i - 1] ||
      tr.wall[i] !== tr.wall[i - 1] ||
      tr.boost[i] !== tr.boost[i - 1] ||
      (i + 1 < tr.count && (tr.surface[i] !== tr.surface[i + 1] || tr.wall[i] !== tr.wall[i + 1]))
    const turned = tr.T[i].dot(tr.T[last]) < 0.9985 || tr.U[i].dot(tr.U[last]) < 0.9985
    if (end || flag || turned || i - last >= 4 || Math.abs(tr.W[i] - tr.W[last]) > 0.4) {
      out.push(i)
      last = i
    }
  }
  return out
}

class GeoBuilder {
  pos: number[] = []
  col: number[] = []
  private c = new THREE.Color()
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: number) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    this.c.setHex(color)
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b)
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number) {
    // a-b önde, d-c arkada (saat yönünün tersi yukarıdan)
    this.tri(a, b, c, color)
    this.tri(a, c, d, color)
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.computeVertexNormals()
    return g
  }
}

function buildRoad(tr: Track): THREE.Object3D {
  const S = pickSamples(tr)
  const gb = new GeoBuilder()
  const v = () => new THREE.Vector3()
  const [l0, r0, l1, r1, el0, er0, el1, er1, b0l, b0r, b1l, b1r, w0l, w0r, w1l, w1r, o0l, o0r, o1l, o1r] = Array.from({ length: 20 }, v)
  const EDGE = 0.55
  const THICK = 0.9
  const WALL_H = 1.15
  const WALL_T = 0.45
  let dist = 0
  for (let k = 0; k < S.length - 1; k++) {
    const a = S[k],
      b = S[k + 1]
    const segLen = tr.P[a].distanceTo(tr.P[b])
    const mid = dist + segLen / 2
    dist += segLen
    if (!tr.surface[a] || !tr.surface[b]) continue
    const corners = (i: number, off: number, ol: THREE.Vector3, or: THREE.Vector3, lift = 0) => {
      const hw = tr.W[i] / 2 - off
      ol.copy(tr.P[i]).addScaledVector(tr.R[i], -hw).addScaledVector(tr.U[i], lift)
      or.copy(tr.P[i]).addScaledVector(tr.R[i], hw).addScaledVector(tr.U[i], lift)
    }
    corners(a, 0, el0, er0)
    corners(b, 0, el1, er1)
    corners(a, EDGE, l0, r0, 0.005)
    corners(b, EDGE, l1, r1, 0.005)
    // yol yüzeyi: hız hissi için 8 m'de bir ton değişimi
    const roadCol = Math.floor(mid / 8) % 2 ? PALETTE.road : PALETTE.road2
    gb.quad(l0, r0, r1, l1, roadCol)
    // kenar şeritleri: 4 m'de bir mercan / krem
    const curb = Math.floor(mid / 4) % 2 ? PALETTE.curb : PALETTE.edge
    gb.quad(el0, l0, l1, el1, curb)
    gb.quad(r0, er0, er1, r1, curb)
    // alt yüz ve yan yüzler
    b0l.copy(el0).addScaledVector(tr.U[a], -THICK)
    b0r.copy(er0).addScaledVector(tr.U[a], -THICK)
    b1l.copy(el1).addScaledVector(tr.U[b], -THICK)
    b1r.copy(er1).addScaledVector(tr.U[b], -THICK)
    gb.quad(b0r, b0l, b1l, b1r, PALETTE.under)
    gb.quad(b0l, el0, el1, b1l, PALETTE.under)
    gb.quad(er0, b0r, b1r, er1, PALETTE.under)
    // duvarlar
    if (tr.wall[a] && tr.wall[b]) {
      for (const side of [-1, 1]) {
        const ea = side < 0 ? el0 : er0
        const eb = side < 0 ? el1 : er1
        w0l.copy(ea).addScaledVector(tr.U[a], WALL_H)
        w1l.copy(eb).addScaledVector(tr.U[b], WALL_H)
        o0l.copy(w0l).addScaledVector(tr.R[a], side * WALL_T)
        o1l.copy(w1l).addScaledVector(tr.R[b], side * WALL_T)
        o0r.copy(ea).addScaledVector(tr.R[a], side * WALL_T).addScaledVector(tr.U[a], -THICK)
        o1r.copy(eb).addScaledVector(tr.R[b], side * WALL_T).addScaledVector(tr.U[b], -THICK)
        if (side < 0) {
          gb.quad(ea, w0l, w1l, eb, PALETTE.wall) // iç yüz
          gb.quad(w0l, o0l, o1l, w1l, PALETTE.wallTop) // üst
          gb.quad(o0l, o0r, o1r, o1l, PALETTE.wall) // dış
        } else {
          gb.quad(w0l, ea, eb, w1l, PALETTE.wall)
          gb.quad(o0l, w0l, w1l, o1l, PALETTE.wallTop)
          gb.quad(o0r, o0l, o1l, o1r, PALETTE.wall)
        }
      }
    }
    void w0r
    void w1r
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(gb.build(), mat)
  mesh.receiveShadow = true
  return mesh
}

function chevronTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#0d6f73'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#7ffff0'
  g.lineWidth = 18
  g.lineJoin = 'miter'
  g.beginPath()
  g.moveTo(14, 100)
  g.lineTo(64, 40)
  g.lineTo(114, 100)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function buildBoost(tr: Track): THREE.Object3D | null {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let vcount = 0
  let run = -1
  const tmp = new THREE.Vector3()
  for (let i = 0; i < tr.count; i++) {
    if (tr.boost[i] && tr.surface[i]) {
      const hw = tr.W[i] / 2 - 2.2
      const along = run < 0 ? 0 : run
      for (const s of [-1, 1]) {
        tmp.copy(tr.P[i]).addScaledVector(tr.R[i], s * hw).addScaledVector(tr.U[i], 0.03)
        pos.push(tmp.x, tmp.y, tmp.z)
        uv.push(s < 0 ? 0 : 3, along / 3.2)
      }
      if (run > 0) {
        const a = vcount - 2,
          b = vcount - 1,
          c = vcount,
          d = vcount + 1
        idx.push(a, c, b, b, c, d)
      }
      vcount += 2
      run = along + 1
    } else run = -1
  }
  if (!vcount) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const mat = new THREE.MeshBasicMaterial({ map: chevronTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
  const m = new THREE.Mesh(g, mat)
  m.name = 'boost'
  return m
}

function checkerTexture(a: string, b: string) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 32
  const g = c.getContext('2d')!
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? a : b
      g.fillRect(x * 8, y * 8, 8, 8)
    }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  return t
}

function buildGates(tr: Track): THREE.Object3D {
  const group = new THREE.Group()
  const postGeo = new THREE.BoxGeometry(0.7, 6.5, 0.7)
  const beamGeo = new THREE.BoxGeometry(1, 1.4, 0.8)
  const mk = (i: number, kind: 'start' | 'cp' | 'finish') => {
    const g = new THREE.Group()
    const w = tr.W[i] + 2.2
    let postMat: THREE.Material, beamMat: THREE.Material
    if (kind === 'cp') {
      postMat = new THREE.MeshStandardMaterial({ color: PALETTE.cp, flatShading: true, emissive: 0x3d7a1f, emissiveIntensity: 0.4 })
      beamMat = postMat
    } else {
      postMat = new THREE.MeshStandardMaterial({ color: kind === 'start' ? PALETTE.edge : PALETTE.curb, flatShading: true })
      beamMat = new THREE.MeshBasicMaterial({ map: checkerTexture('#1d1a2b', '#fff1dc') })
    }
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat)
      p.position.set((s * w) / 2, 3.25, 0)
      p.castShadow = true
      g.add(p)
    }
    const beam = new THREE.Mesh(beamGeo, beamMat)
    beam.scale.x = w + 0.7
    beam.position.set(0, 6.2, 0)
    g.add(beam)
    // yerleştir
    const m = new THREE.Matrix4().makeBasis(tr.R[i], tr.U[i], tr.T[i].clone().negate())
    g.quaternion.setFromRotationMatrix(m)
    g.position.copy(tr.P[i])
    g.userData.kind = kind
    group.add(g)
    // yere çizgi
    if (kind !== 'cp') {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(tr.W[i] - 1.1, 1.6).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: checkerTexture('#1d1a2b', '#fff1dc'), polygonOffset: true, polygonOffsetFactor: -2 }),
      )
      line.position.set(0, 0.03, 0)
      g.add(line)
    }
  }
  mk(tr.start + 9, 'start')
  tr.cps.forEach((i) => mk(i, 'cp'))
  mk(tr.finish, 'finish')
  return group
}

function buildPillars(tr: Track): THREE.Object3D {
  const ground = groundLevel(tr)
  const list: THREE.Matrix4[] = []
  for (let i = 6; i < tr.count; i += 22) {
    if (!tr.surface[i] || tr.U[i].y < 0.8) continue
    const top = tr.P[i].y - 0.9
    const h = top - ground
    if (h < 1.5) continue
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(tr.P[i].x, ground + h / 2, tr.P[i].z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tr.T[i].x, tr.T[i].z)),
      new THREE.Vector3(Math.min(tr.W[i] * 0.45, 5), h, 1.6),
    )
    list.push(m)
  }
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.pillar, flatShading: true, roughness: 0.9 })
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
  list.forEach((m, i) => inst.setMatrixAt(i, m))
  inst.count = list.length
  inst.receiveShadow = true
  return inst
}

export function groundLevel(tr: Track) {
  return tr.minY - 16
}

// basit değer gürültüsü
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise(x: number, y: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y)
  const xf = x - xi,
    yf = y - yi
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi),
    b = hash2(xi + 1, yi),
    c = hash2(xi, yi + 1),
    d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function buildScenery(tr: Track, low: boolean): THREE.Object3D {
  const group = new THREE.Group()
  const base = groundLevel(tr)
  const b = tr.bounds
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 1400
  const seg = low ? 70 : 100

  // pist örneklerinden yatay mesafe ızgarası
  const pts: number[] = []
  for (let i = 0; i < tr.count; i += 3) pts.push(tr.P[i].x, tr.P[i].z)
  const cell = 40
  const grid = new Map<string, number[]>()
  for (let k = 0; k < pts.length; k += 2) {
    const key = Math.floor(pts[k] / cell) + ',' + Math.floor(pts[k + 1] / cell)
    let arr = grid.get(key)
    if (!arr) grid.set(key, (arr = []))
    arr.push(pts[k], pts[k + 1])
  }
  const distTo = (x: number, z: number) => {
    const gx = Math.floor(x / cell),
      gz = Math.floor(z / cell)
    let best = 1e9
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const arr = grid.get(gx + dx + ',' + (gz + dz))
        if (!arr) continue
        for (let k = 0; k < arr.length; k += 2) {
          const d = (arr[k] - x) ** 2 + (arr[k + 1] - z) ** 2
          if (d < best) best = d
        }
      }
    return Math.sqrt(best)
  }
  const heightAt = (x: number, z: number) => {
    const d = distTo(x, z)
    const far = Math.min(1, Math.max(0, (d - 35) / 160))
    const n = noise(x / 140, z / 140) * 0.65 + noise(x / 48, z / 48) * 0.35
    return base + (n * 70 - 8) * far * far + (noise(x / 9, z / 9) - 0.5) * 1.2
  }

  const plane = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2).toNonIndexed()
  const p = plane.attributes.position as THREE.BufferAttribute
  const cols: number[] = []
  const cSand = new THREE.Color(PALETTE.sand),
    cClay = new THREE.Color(PALETTE.clay),
    cRock = new THREE.Color(PALETTE.rock),
    tmpc = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx,
      z = p.getZ(i) + cz
    p.setXYZ(i, x, heightAt(x, z), z)
  }
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - base
    const t = Math.min(1, Math.max(0, y / 45))
    if (t < 0.5) tmpc.copy(cSand).lerp(cClay, t * 2)
    else tmpc.copy(cClay).lerp(cRock, (t - 0.5) * 2)
    // tabakalı kanyon görünümü
    if (Math.floor(y / 7) % 2 === 1 && t > 0.15) tmpc.multiplyScalar(0.92)
    for (let k = 0; k < 3; k++) cols.push(tmpc.r, tmpc.g, tmpc.b)
  }
  plane.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  plane.computeVertexNormals()
  const ground = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }))
  ground.receiveShadow = true
  group.add(ground)

  // mesalar (düz tepeli kayalar), taşlar, çalılar
  const rnd = mulberry(tr.count * 7 + 13)
  const mesaGeo = new THREE.CylinderGeometry(1, 1.15, 1, 7)
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const shrubGeo = new THREE.IcosahedronGeometry(1, 0)
  const place = (geo: THREE.BufferGeometry, color: number, n: number, minD: number, maxD: number, scale: (r: () => number) => THREE.Vector3, sink = 0) => {
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 })
    const inst = new THREE.InstancedMesh(geo, mat, n)
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      e = new THREE.Euler()
    let c = 0
    for (let tries = 0; tries < n * 6 && c < n; tries++) {
      const x = cx + (rnd() - 0.5) * size * 0.9,
        z = cz + (rnd() - 0.5) * size * 0.9
      const d = distTo(x, z)
      if (d < minD || d > maxD) continue
      const s = scale(rnd)
      e.set(0, rnd() * Math.PI * 2, 0)
      q.setFromEuler(e)
      m.compose(new THREE.Vector3(x, heightAt(x, z) + s.y * (0.5 - sink), z), q, s)
      inst.setMatrixAt(c++, m)
    }
    inst.count = c
    inst.castShadow = false
    inst.receiveShadow = true
    group.add(inst)
  }
  place(mesaGeo, PALETTE.clay, low ? 18 : 30, 160, 900, (r) => {
    const w = 25 + r() * 45
    return new THREE.Vector3(w, 40 + r() * 70, w * (0.7 + r() * 0.5))
  }, 0.1)
  place(rockGeo, PALETTE.rock, low ? 60 : 120, 22, 500, (r) => {
    const s = 1.5 + r() * 5
    return new THREE.Vector3(s, s * (0.6 + r() * 0.5), s * (0.8 + r() * 0.4))
  }, 0.3)
  place(shrubGeo, PALETTE.shrub, low ? 120 : 260, 16, 420, (r) => {
    const s = 0.8 + r() * 1.6
    return new THREE.Vector3(s, s * 0.8, s)
  }, 0.25)
  return group
}

function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
