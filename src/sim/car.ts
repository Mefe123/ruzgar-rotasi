// Araç fiziği: dört tekerlekli katı gövde. Her tekerlek pist yüzeyine (yerel normal boyunca) ışın atar,
// yay-amortisör süspansiyon ve kayma açısına bağlı lastik kuvveti üretir. Döngü, duvar sürüşü ve sıçrama
// ayrı kural olmadan gövde dinamiğinden çıkar. Sabit adım: 120 Hz dış, 3 alt adım (360 Hz).
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { Track, type Frame } from './track'

export interface Input {
  throttle: number // 0..1
  brake: number // 0..1 (fren / geri)
  steer: number // -1 sol .. +1 sağ
  drift: boolean
}

export const DT = 1 / 120
const SUB = 3
const H = DT / SUB
const G = new Vector3(0, -9.81, 0)

export const CAR = {
  mass: 1150,
  inertia: new Vector3(1900, 2300, 750), // gövde ekseninde (x: yunuslama, y: sapma, z: yalpa)
  // tekerlek bağlantı noktaları (ağırlık merkezine göre; -Z ileri)
  wheels: [
    new Vector3(0.95, -0.12, -1.38),
    new Vector3(-0.95, -0.12, -1.38),
    new Vector3(0.95, -0.12, 1.42),
    new Vector3(-0.95, -0.12, 1.42),
  ],
  restLen: 0.42,
  radius: 0.44,
  spring: 26000,
  damp: 3600,
  bump: 260000, // süspansiyon sonu
  antiRoll: 38000, // denge çubuğu
  mu: 2.8, // lastik sürtünmesi (yarış lastiği, abartılı)
  driftMu: 0.78, // drift sırasında arka tekerlek çarpanı
  slipRef: 0.085, // tam tutuşa ulaşılan kayma açısı (rad)
  downforce: 4.0, // N/(m/s)²
  drag: 0.36,
  engine: 15.5, // m/s² kalkış
  vmax: 66, // motorun itebildiği hız (m/s ~ 238 km/sa)
  boost: 30, // m/s² ek itiş
  vboost: 92,
  brake: 1.0, // fren, tutuşun oranı
  reverseMax: 15,
  steerLow: 0.55, // rad
  steerFall: 16, // hızla direksiyon açısı azalır
  airYaw: 1.4,
  airPitch: 2.2,
  halfW: 1.0,
  halfL: 2.15,
}

/** düz virajda tutuşla gidilebilecek yaklaşık hız (pilot ve tasarım için) */
export function cornerSpeed(r: number) {
  const k = (CAR.mu * CAR.downforce) / CAR.mass
  const den = 1 - k * r
  return den <= 0.05 ? 999 : Math.sqrt((CAR.mu * 9.81 * r) / den)
}

/** ağırlık merkezinin yerden yüksekliği (durağan) */
export const COM_HEIGHT = -CAR.wheels[0].y + CAR.restLen - (CAR.mass * 9.81) / 4 / CAR.spring + CAR.radius

// gövde köşeleri (çarpışma için)
const CORNERS: Vector3[] = []
for (const x of [-CAR.halfW, CAR.halfW])
  for (const z of [-CAR.halfL, CAR.halfL]) for (const y of [-0.38, 0.55]) CORNERS.push(new Vector3(x, y, z))

const v1 = new Vector3()
const v2 = new Vector3()
const v3 = new Vector3()
const v4 = new Vector3()
const v5 = new Vector3()
const F = new Vector3()
const TQ = new Vector3()

interface Contact {
  ok: boolean
  i: number
  h: number // yüzeyden yükseklik (normal boyunca)
  d: number // pist ortasına yanal uzaklık
  fr: Frame
}

export class CarSim {
  p = new Vector3() // ağırlık merkezi
  v = new Vector3()
  q = new Quaternion()
  w = new Vector3() // açısal hız (dünya)
  f = new Vector3(0, 0, -1)
  up = new Vector3(0, 1, 0)
  right = new Vector3(1, 0, 0)
  grounded = true
  idx = 0
  onBoost = false
  drifting = false
  slip = 0 // arka tekerlek yanal kayması (m/s), efektler için
  landed = 0
  scrape = 0 // duvar sürtünmesi (efekt)
  fell = false
  airTime = 0
  steerAngle = 0
  wheelComp = [0, 0, 0, 0]
  wheelContact = [false, false, false, false]
  wheelSpin = [0, 0, 0, 0]
  private iInvBody = new Vector3(1 / CAR.inertia.x, 1 / CAR.inertia.y, 1 / CAR.inertia.z)
  private rot = new Matrix3()
  private iInv = new Matrix3()
  private stuck = 0
  private cts: Contact[] = Array.from({ length: 4 }, () => mkContact())
  private probe: Contact = mkContact()

  constructor(public track: Track) {}

  reset(idx: number, speed = 0) {
    const tr = this.track
    this.idx = Math.max(0, Math.min(tr.count - 2, idx))
    const i = this.idx
    this.p.copy(tr.P[i]).addScaledVector(tr.U[i], COM_HEIGHT)
    basisQuat(tr.R[i], tr.U[i], tr.T[i], this.q)
    this.v.copy(tr.T[i]).multiplyScalar(speed)
    this.w.set(0, 0, 0)
    this.grounded = true
    this.fell = false
    this.airTime = 0
    this.stuck = 0
    this.slip = 0
    this.steerAngle = 0
    this.drifting = false
    this.wheelComp.fill(CAR.restLen * 0.4)
    this.updateAxes()
  }

  get speed() {
    return this.v.length()
  }
  get fwdSpeed() {
    return this.v.dot(this.f)
  }

  quaternion(out: Quaternion) {
    return out.copy(this.q)
  }

  /** tekerleğin yere değdiği nokta (efektler için) */
  wheelPoint(k: number, out: Vector3) {
    return out
      .copy(CAR.wheels[k])
      .applyQuaternion(this.q)
      .add(this.p)
      .addScaledVector(this.up, -(CAR.restLen - this.wheelComp[k] + CAR.radius))
  }

  step(inp: Input) {
    this.landed = 0
    this.scrape = 0
    const wasGrounded = this.grounded
    for (let s = 0; s < SUB; s++) this.substep(inp)
    // merkez izleme
    this.locate()
    if (!this.grounded) this.airTime += DT
    else this.airTime = 0
    if (!wasGrounded && this.grounded) this.landed = Math.max(this.landed, 0)
    // sıkışma / düşme
    if (this.p.y < this.track.minY - 35 || this.airTime > 9) this.fell = true
    if (this.speed < 1.2 && !this.grounded && this.up.y < 0.2) {
      this.stuck += DT
      if (this.stuck > 2) this.fell = true
    } else this.stuck = 0
  }

  private updateAxes() {
    this.q.normalize()
    this.f.set(0, 0, -1).applyQuaternion(this.q)
    this.up.set(0, 1, 0).applyQuaternion(this.q)
    this.right.set(1, 0, 0).applyQuaternion(this.q)
    // dünya eylemsizlik tersi: R * I⁻¹ * Rᵀ
    const r = this.rot.setFromMatrix4(m4.makeRotationFromQuaternion(this.q))
    const e = r.elements
    const ib = this.iInvBody
    const o = this.iInv.elements
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        o[a + b * 3] = e[a] * ib.x * e[b] + e[a + 3] * ib.y * e[b + 3] + e[a + 6] * ib.z * e[b + 6]
  }

  /** noktanın pist yüzeyine göre konumu */
  private surface(pt: Vector3, out: Contact): Contact {
    const tr = this.track
    const loc = tr.track(pt, this.idx)
    tr.frameAt(loc.i, loc.f, out.fr)
    v5.copy(pt).sub(out.fr.p)
    out.i = loc.i
    out.h = v5.dot(out.fr.u)
    out.d = v5.dot(out.fr.r)
    const along = v5.dot(out.fr.t)
    out.ok =
      tr.surface[loc.i] &&
      tr.surface[Math.min(tr.count - 1, loc.i + 1)] &&
      Math.abs(along) < 2.5 &&
      Math.abs(out.d) < out.fr.w / 2 + 0.25
    return out
  }

  private locate() {
    const tr = this.track
    const c = this.surface(this.p, this.probe)
    if (c.ok && Math.abs(c.h) < 12) this.idx = c.i
    else {
      const near = tr.nearest(this.p, this.idx - 30, this.idx + 180)
      if (near.dist < 45) this.idx = near.i
    }
    this.onBoost = this.grounded && c.ok && tr.boost[c.i]
  }

  private pointVel(r: Vector3, out: Vector3) {
    return out.copy(this.w).cross(r).add(this.v)
  }

  private applyImpulse(J: Vector3, r: Vector3) {
    this.v.addScaledVector(J, 1 / CAR.mass)
    v4.copy(r).cross(J).applyMatrix3(this.iInv)
    this.w.add(v4)
  }

  /** tek temas noktasında itme (normal + sürtünme) */
  private contact(r: Vector3, n: Vector3, depth: number, e: number, mu: number) {
    // konum düzeltmesi
    this.p.addScaledVector(n, depth * 0.8)
    const vr = this.pointVel(r, v1)
    const vn = vr.dot(n)
    if (vn >= 0) return 0
    const rn = v2.copy(r).cross(n).applyMatrix3(this.iInv).cross(r)
    const kn = 1 / CAR.mass + n.dot(rn)
    const jn = (-(1 + e) * vn) / kn
    this.applyImpulse(v3.copy(n).multiplyScalar(jn), r)
    // sürtünme
    const vr2 = this.pointVel(r, v1)
    const t = vr2.addScaledVector(n, -vr2.dot(n))
    const vt = t.length()
    if (vt > 1e-4) {
      t.multiplyScalar(1 / vt)
      const rt = v2.copy(r).cross(t).applyMatrix3(this.iInv).cross(r)
      const kt = 1 / CAR.mass + t.dot(rt)
      const jt = Math.min(vt / kt, mu * jn)
      this.applyImpulse(v3.copy(t).multiplyScalar(-jt), r)
    }
    return jn
  }

  private substep(inp: Input) {
    const tr = this.track
    this.updateAxes()
    F.copy(G).multiplyScalar(CAR.mass)
    TQ.set(0, 0, 0)
    const speed = this.v.length()
    const fwdV = this.v.dot(this.f)

    // direksiyon: hız arttıkça açı daralır
    const maxSteer = CAR.steerLow / (1 + Math.abs(fwdV) / CAR.steerFall)
    const target = -inp.steer * maxSteer
    this.steerAngle += Math.max(-H * 6, Math.min(H * 6, target - this.steerAngle))

    this.drifting = inp.drift && speed > 12
    let grounded = 0
    const rArm = new Vector3()
    const anchor = new Vector3()
    const fw = new Vector3()
    const sd = new Vector3()

    // sürüş kuvveti dağıtımı için önce temasları bul
    for (let k = 0; k < 4; k++) {
      anchor.copy(CAR.wheels[k]).applyQuaternion(this.q).add(this.p)
      const c = this.surface(anchor, this.cts[k])
      const cosA = this.up.dot(c.fr.u)
      let comp = -1
      if (c.ok && cosA > 0.25) {
        const dist = c.h / cosA // gövde aşağısı boyunca yüzeye uzaklık
        comp = CAR.restLen + CAR.radius - dist
        if (dist < -0.6) comp = -1 // yüzeyin altına geçmiş: temas yok
      }
      this.wheelContact[k] = comp > 0
      if (comp > 0) grounded++
      this.wheelComp[k] = Math.max(0, Math.min(CAR.restLen, comp))
    }
    this.grounded = grounded > 0

    // motor itişi (dört çeker)
    let drive = 0
    if (inp.throttle > 0) {
      if (fwdV < -0.5) drive = 0
      else drive = CAR.engine * inp.throttle * Math.max(0, 1 - (fwdV / CAR.vmax) ** 2)
    }
    const braking = inp.brake > 0 && fwdV > 0.8
    const throttleRev = inp.throttle > 0 && fwdV < -0.5
    let reverse = 0
    if (inp.brake > 0 && fwdV <= 0.8 && fwdV > -CAR.reverseMax) reverse = CAR.engine * 0.55 * inp.brake

    let slipSum = 0
    for (let k = 0; k < 4; k++) {
      if (!this.wheelContact[k]) continue
      const c = this.cts[k]
      const N = c.fr.u
      const front = k < 2
      rArm.copy(CAR.wheels[k]).applyQuaternion(this.q)
      const comp = CAR.restLen + CAR.radius - c.h / Math.max(0.25, this.up.dot(N))
      // temas noktası
      const cp = v1.copy(rArm).addScaledVector(this.up, -(CAR.restLen + CAR.radius - comp))
      const vc = this.pointVel(cp, v2)
      const vn = vc.dot(N)
      // süspansiyon
      let fz = CAR.spring * Math.min(comp, CAR.restLen) - CAR.damp * vn
      if (comp > CAR.restLen) fz += CAR.bump * (comp - CAR.restLen) - CAR.damp * 2 * vn
      // denge çubuğu: aynı akstaki tekerleklerin sıkışma farkı
      const pair = k ^ 1
      const other = this.wheelContact[pair] ? this.wheelComp[pair] : 0
      fz += CAR.antiRoll * (Math.min(comp, CAR.restLen) - other)
      fz = Math.max(0, fz)
      // yönler: tekerlek ileri (önde direksiyonlu), yüzey düzleminde
      fw.copy(this.f)
      if (front) fw.applyAxisAngle(this.up, this.steerAngle)
      fw.addScaledVector(N, -fw.dot(N)).normalize()
      sd.copy(fw).cross(N).normalize()
      const vlong = vc.dot(fw)
      const vlat = vc.dot(sd)
      this.wheelSpin[k] = vlong / CAR.radius
      // lastik
      let mu = CAR.mu * tr.grip[c.i]
      const drift = !front && this.drifting
      if (drift) mu *= CAR.driftMu
      const fmax = mu * fz
      const slipAng = Math.atan2(vlat, Math.abs(vlong) + 2.5)
      let flat = -fmax * Math.tanh(slipAng / (drift ? CAR.slipRef * 2.2 : CAR.slipRef))
      let flong = 0
      if (drive > 0) flong += (drive * CAR.mass) / grounded
      if (reverse > 0) flong -= (reverse * CAR.mass) / grounded
      if (braking) flong -= Math.min(fmax * CAR.brake * inp.brake, (Math.abs(vlong) * CAR.mass) / 4 / H)
      if (throttleRev) flong += Math.min(fmax * CAR.brake, (Math.abs(vlong) * CAR.mass) / 4 / H)
      if (inp.throttle === 0 && inp.brake === 0) flong -= Math.sign(vlong) * Math.min(Math.abs(vlong) * 200, 350)
      // sürtünme çemberi
      const tot = Math.hypot(flat, flong)
      if (tot > fmax && tot > 0) {
        flat *= fmax / tot
        flong *= fmax / tot
      }
      if (k >= 2) slipSum += vlat / 2
      // yay kuvveti temas noktasında; lastik kuvvetleri ağırlık merkezine yakın uygulanır
      // (devrilmeyi ve aşırı yalpayı önler, arcade dengesi)
      v3.copy(N).multiplyScalar(fz)
      F.add(v3)
      TQ.add(v4.copy(cp).cross(v3))
      v3.copy(fw).multiplyScalar(flong).addScaledVector(sd, flat)
      F.add(v3)
      const low = v5.copy(cp).addScaledVector(this.up, -cp.dot(this.up) - 0.12)
      TQ.add(v4.copy(low).cross(v3))
    }
    this.slip = slipSum
    if (this.grounded) {
      // yere basma kuvveti (hızla artar)
      const s0 = this.cts.find((c, k) => this.wheelContact[k])!
      F.addScaledVector(s0.fr.u, -CAR.downforce * speed * speed)
      // hız şeridi
      const bi = this.cts[0].i
      if (tr.boost[bi] || tr.boost[this.cts[2].i]) F.addScaledVector(this.f, CAR.boost * CAR.mass * Math.max(0, 1 - fwdV / CAR.vboost))
      // yalpa ve sapma sönümü (savrulmayı yumuşatır)
      TQ.addScaledVector(this.up, -this.w.dot(this.up) * 380)
      // yalpa sönümü
      TQ.addScaledVector(this.f, -this.w.dot(this.f) * 2600)
    } else {
      // havada kontrol
      TQ.addScaledVector(this.up, -inp.steer * CAR.airYaw * CAR.inertia.y)
      const pitch = (inp.throttle > 0 ? 1 : 0) - (inp.brake > 0 ? 1 : 0)
      TQ.addScaledVector(this.right, -pitch * CAR.airPitch * CAR.inertia.x * 0.35)
      TQ.addScaledVector(this.w, -CAR.inertia.x * 1.6)
    }
    // hava direnci
    F.addScaledVector(this.v, -CAR.drag * speed)
    // azami hız üstünde (yalnızca motor dışı) yavaşça düş
    if (fwdV > CAR.vboost) F.addScaledVector(this.f, -(fwdV - CAR.vboost) * CAR.mass * 0.5)

    // tümleştir
    this.v.addScaledVector(F, H / CAR.mass)
    this.w.add(v4.copy(TQ).applyMatrix3(this.iInv).multiplyScalar(H))
    this.w.multiplyScalar(Math.exp(-0.4 * H))
    this.p.addScaledVector(this.v, H)
    const wq = new Quaternion(this.w.x * H * 0.5, this.w.y * H * 0.5, this.w.z * H * 0.5, 0).multiply(this.q)
    this.q.set(this.q.x + wq.x, this.q.y + wq.y, this.q.z + wq.z, this.q.w + wq.w).normalize()
    this.updateAxes()

    this.collide()
  }

  /** gövde köşeleri: yol yüzeyi ve kenar duvarları */
  private collide() {
    const tr = this.track
    const r = new Vector3()
    const pt = new Vector3()
    const n = new Vector3()
    for (const corner of CORNERS) {
      r.copy(corner).applyQuaternion(this.q)
      pt.copy(r).add(this.p)
      const c = this.surface(pt, this.probe)
      const halfW = c.fr.w / 2
      // yol yüzeyi (tavan üstüne çarpma / sert iniş)
      if (c.ok && c.h < 0 && c.h > -1.6) {
        const vn = this.pointVel(r, v1).dot(c.fr.u)
        const j = this.contact(r, c.fr.u, -c.h, 0.05, 0.5)
        if (j > 0 && -vn > this.landed) this.landed = -vn
      }
      // duvar
      const along = Math.abs(v5.copy(pt).sub(c.fr.p).dot(c.fr.t))
      if (tr.wall[c.i] && along < 2.5 && Math.abs(c.d) > halfW - 0.02 && c.h > -1.2 && c.h < 2.6) {
        const s = Math.sign(c.d)
        n.copy(c.fr.r).multiplyScalar(-s)
        const j = this.contact(r, n, Math.abs(c.d) - halfW + 0.02, 0.25, 0.25)
        if (j > 0) this.scrape = Math.max(this.scrape, j / CAR.mass)
      }
    }
  }
}

const m4 = new Matrix4()

function mkContact(): Contact {
  return { ok: false, i: 0, h: 0, d: 0, fr: { p: new Vector3(), t: new Vector3(), u: new Vector3(), r: new Vector3(), w: 14 } }
}

/** sağ, yukarı, ileri vektörlerinden dönüş */
export function basisQuat(R: Vector3, U: Vector3, T: Vector3, out: Quaternion) {
  const m = new Matrix3().set(R.x, U.x, -T.x, R.y, U.y, -T.y, R.z, U.z, -T.z)
  const e = m.elements
  // Matrix3 → dörtlü (Shepperd)
  const m00 = e[0],
    m01 = e[3],
    m02 = e[6],
    m10 = e[1],
    m11 = e[4],
    m12 = e[7],
    m20 = e[2],
    m21 = e[5],
    m22 = e[8]
  const tr = m00 + m11 + m22
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    out.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    out.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    out.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    out.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
  }
  return out.normalize()
}
