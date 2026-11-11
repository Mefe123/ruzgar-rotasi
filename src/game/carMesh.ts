// Özgün low-poly araç: kama burunlu, iri tekerlekli "kum böceği".
import * as THREE from 'three'

export interface CarView {
  group: THREE.Group
  wheels: THREE.Object3D[]
  frontPivots: THREE.Object3D[]
  label?: THREE.Sprite
  materials: THREE.Material[]
  setPose(pos: THREE.Vector3, q: THREE.Quaternion): void
  animate(speed: number, steer: number, dt: number): void
  dispose(): void
}

const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 9).rotateZ(Math.PI / 2)
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 6).rotateZ(Math.PI / 2)

function wedgeBody(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2.0, 0.6, 4.3, 1, 1, 2)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i)
    // ön (−Z) üst köşeleri alçalt: kama burun
    if (z < -1 && y > 0) p.setY(i, y - 0.34)
    // arka üst hafif yükselsin
    if (z > 1 && y > 0) p.setY(i, y + 0.06)
    // alt kenarlar içe
    if (y < 0) p.setX(i, x * 0.9)
  }
  g.computeVertexNormals()
  return g.toNonIndexed()
}

function cabin(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1.55, 0.55, 1.9)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.72)
      // ön cam yatık
      if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) + 0.55)
      else p.setZ(i, p.getZ(i) - 0.15)
    }
  }
  g.computeVertexNormals()
  return g.toNonIndexed()
}

const bodyGeo = wedgeBody()
const cabinGeo = cabin()
const spoilerGeo = new THREE.BoxGeometry(2.1, 0.09, 0.5)
const strutGeo = new THREE.BoxGeometry(0.1, 0.38, 0.2)
const stripeGeo = new THREE.BoxGeometry(0.45, 0.02, 3.2)
const lightGeo = new THREE.BoxGeometry(0.42, 0.13, 0.06)
const scoopGeo = new THREE.BoxGeometry(0.6, 0.18, 0.7)

export function makeCar(color: string | number, opts: { ghost?: boolean; opacity?: number; name?: string } = {}): CarView {
  const ghost = !!opts.ghost
  const op = opts.opacity ?? (ghost ? 0.38 : 1)
  const mk = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({
      color: c,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
      transparent: op < 1,
      opacity: op,
      depthWrite: op >= 1,
      ...extra,
    })
  const body = mk(color, { roughness: 0.4, metalness: 0.15 })
  const dark = mk(0x1d1a2b, { roughness: 0.8 })
  const glass = mk(0x27324f, { roughness: 0.15, metalness: 0.4 })
  const cream = mk(0xfff1dc)
  const lamp = mk(0xfff6c8, { emissive: 0xffe9a3, emissiveIntensity: 1.6 })
  const tail = mk(0xff4a5a, { emissive: 0xff2a3d, emissiveIntensity: 1.2 })
  const materials = [body, dark, glass, cream, lamp, tail]

  const group = new THREE.Group()
  const root = new THREE.Group() // gövde salınımı için
  group.add(root)

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = !ghost
    parent.add(m)
    return m
  }
  add(bodyGeo, body, 0, 0.78, 0)
  add(cabinGeo, glass, 0, 1.33, 0.35)
  add(stripeGeo, cream, 0, 1.09, 0.4).scale.set(1, 1, 1)
  add(scoopGeo, dark, 0, 1.15, -0.95)
  add(spoilerGeo, dark, 0, 1.58, 1.95)
  add(strutGeo, dark, 0.6, 1.36, 1.95)
  add(strutGeo, dark, -0.6, 1.36, 1.95)
  add(lightGeo, lamp, 0.62, 0.72, -2.16)
  add(lightGeo, lamp, -0.62, 0.72, -2.16)
  add(lightGeo, tail, 0.65, 0.95, 2.16)
  add(lightGeo, tail, -0.65, 0.95, 2.16)

  const wheels: THREE.Object3D[] = []
  const frontPivots: THREE.Object3D[] = []
  for (const [x, z] of [
    [1.08, -1.4],
    [-1.08, -1.4],
    [1.08, 1.45],
    [-1.08, 1.45],
  ] as const) {
    const pivot = new THREE.Group()
    pivot.position.set(x, 0.46, z)
    group.add(pivot)
    const w = new THREE.Group()
    pivot.add(w)
    const tire = new THREE.Mesh(wheelGeo, dark)
    tire.castShadow = !ghost
    w.add(tire)
    const hub = new THREE.Mesh(hubGeo, cream)
    w.add(hub)
    wheels.push(w)
    if (z < 0) frontPivots.push(pivot)
  }

  let label: THREE.Sprite | undefined
  if (opts.name) {
    label = makeLabel(opts.name, typeof color === 'string' ? color : '#' + new THREE.Color(color).getHexString())
    label.position.set(0, 3.2, 0)
    group.add(label)
  }

  let roll = 0
  return {
    group,
    wheels,
    frontPivots,
    label,
    materials,
    setPose(pos, q) {
      group.position.copy(pos)
      group.quaternion.copy(q)
    },
    animate(speed, steer, dt) {
      for (const w of wheels) w.rotation.x -= (speed / 0.46) * dt
      for (const p of frontPivots) p.rotation.y = -steer * 0.45
      roll += (steer * Math.min(1, Math.abs(speed) / 30) * 0.06 - roll) * Math.min(1, dt * 8)
      root.rotation.z = roll
    },
    dispose() {
      materials.forEach((m) => m.dispose())
      if (label) {
        ;(label.material as THREE.SpriteMaterial).map?.dispose()
        label.material.dispose()
      }
    },
  }
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  g.font = '700 30px system-ui, sans-serif'
  const w = Math.min(240, g.measureText(text).width + 28)
  g.fillStyle = 'rgba(20,16,36,0.72)'
  g.beginPath()
  g.roundRect((256 - w) / 2, 10, w, 44, 22)
  g.fill()
  g.fillStyle = color
  g.beginPath()
  g.arc((256 - w) / 2 + 18, 32, 6, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 128 + 6, 33, 200)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  s.scale.set(4, 1, 1)
  s.renderOrder = 10
  return s
}
