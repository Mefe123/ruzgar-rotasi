// Arcade araç modeli: pist şeridine yapışan, döngü ve duvar sürüşünü destekleyen basit fizik.
import { Quaternion, Vector3, Matrix4 } from 'three'
import { Track, type Frame } from './track'

export interface Input {
  throttle: number // 0..1
  brake: number // 0..1 (fren / geri)
  steer: number // -1 sol .. +1 sağ
  drift: boolean
}

export const DT = 1 / 120
const G = new Vector3(0, -9.81, 0)

export const CAR = {
  vmax: 58, // m/s (~209 km/s)
  vboost: 82,
  accel: 26,
  boostAccel: 42,
  brake: 38,
  reverseMax: 14,
  rolling: 0.6,
  grip: 9,
  driftGrip: 1.6,
  yawLow: 2.6,
  yawHigh: 1.35,
  adhesion: 7, // döngü/duvarda tutunma payı (m/s²)
  halfWidth: 1.0,
}

const tmp = new Vector3()
const tmp2 = new Vector3()
const right = new Vector3()

export class CarSim {
  p = new Vector3()
  v = new Vector3()
  f = new Vector3(0, 0, -1) // burun yönü
  up = new Vector3(0, 1, 0)
  grounded = true
  idx = 0
  frac = 0
  onBoost = false
  drifting = false
  slip = 0 // yanal kayma (m/s), efektler için
  landed = 0 // son inişin sertliği
  fell = false
  airTime = 0
  private fr: Frame = { p: new Vector3(), t: new Vector3(), u: new Vector3(), r: new Vector3(), w: 14 }

  constructor(public track: Track) {}

  reset(idx: number, speed = 0) {
    const tr = this.track
    this.idx = Math.max(0, Math.min(tr.count - 2, idx))
    this.frac = 0
    this.p.copy(tr.P[this.idx])
    this.f.copy(tr.T[this.idx])
    this.up.copy(tr.U[this.idx])
    this.v.copy(this.f).multiplyScalar(speed)
    this.grounded = true
    this.fell = false
    this.airTime = 0
    this.slip = 0
    this.drifting = false
  }

  get speed() {
    return this.v.length()
  }

  /** ileri hız (işaretli) */
  get fwdSpeed() {
    return this.v.dot(this.f)
  }

  step(inp: Input) {
    this.landed = 0
    if (this.grounded) this.stepGround(inp)
    else this.stepAir(inp)
  }

  private stepGround(inp: Input) {
    const tr = this.track
    const fr = this.fr
    const loc = tr.track(this.p, this.idx)
    this.idx = loc.i
    this.frac = loc.f
    tr.frameAt(loc.i, loc.f, fr)
    const d = tmp.copy(this.p).sub(fr.p).dot(fr.r)
    const halfW = fr.w / 2
    const surf = tr.surface[loc.i] && tr.surface[Math.min(tr.count - 1, loc.i + 1)]
    if (!surf || Math.abs(d) > halfW + 0.4) {
      this.grounded = false
      this.stepAir(inp)
      return
    }
    // yüzeye oturt
    this.p.copy(fr.p).addScaledVector(fr.r, d)
    const U = fr.u
    // hızı yüzey düzlemine al, büyüklüğü koru (döngüde hız kaybı olmasın)
    const vn = this.v.dot(U)
    const mag = this.v.length()
    this.v.addScaledVector(U, -vn)
    const tl = this.v.length()
    if (tl > 1e-4 && vn > -2) this.v.multiplyScalar(Math.min(mag, tl + Math.abs(vn) * 0.6) / tl)
    this.up.copy(U)
    this.f.addScaledVector(U, -this.f.dot(U)).normalize()

    // yerçekiminin yüzeye paralel bileşeni
    tmp.copy(G).addScaledVector(U, -G.dot(U))
    this.v.addScaledVector(tmp, DT)

    right.copy(this.f).cross(U).normalize()
    let fwd = this.v.dot(this.f)
    const speed = Math.abs(fwd)

    // boost
    this.onBoost = tr.boost[loc.i]
    const vmax = this.onBoost ? CAR.vboost : CAR.vmax

    // gaz / fren / geri
    let a = 0
    if (inp.throttle > 0) {
      if (fwd < -0.5) a += CAR.brake * inp.throttle
      else a += CAR.accel * inp.throttle * Math.max(0, 1 - fwd / vmax)
    }
    if (inp.brake > 0) {
      if (fwd > 0.5) a -= CAR.brake * inp.brake
      else if (fwd > -CAR.reverseMax) a -= CAR.accel * 0.6 * inp.brake
    }
    if (this.onBoost) a += CAR.boostAccel * Math.max(0, 1 - fwd / CAR.vboost)
    if (inp.throttle === 0 && inp.brake === 0) a -= Math.sign(fwd) * Math.min(Math.abs(fwd) / DT, CAR.rolling)
    // azami hızın üstünde yavaşça düş
    if (fwd > vmax) a -= (fwd - vmax) * 0.8
    this.v.addScaledVector(this.f, a * DT)
    fwd = this.v.dot(this.f)

    // drift
    this.drifting = inp.drift && speed > 12
    // direksiyon
    const sp01 = Math.min(1, speed / CAR.vmax)
    let yaw = CAR.yawLow + (CAR.yawHigh - CAR.yawLow) * sp01
    yaw *= Math.min(1, speed / 6)
    if (this.drifting) yaw *= 1.45
    const dir = fwd < -0.5 ? -1 : 1
    const ang = -inp.steer * yaw * dir * DT
    this.f.applyAxisAngle(U, ang)
    // drift sırasında hız yönü burunla birlikte biraz döner (kaymayı tatlı tutar)
    if (this.drifting) this.v.applyAxisAngle(U, ang * 0.55)

    // yanal tutuş
    right.copy(this.f).cross(U).normalize()
    const side = this.v.dot(right)
    const grip = this.drifting ? CAR.driftGrip : CAR.grip
    const keep = Math.exp(-grip * DT)
    const lost = side * (1 - keep)
    this.v.addScaledVector(right, -lost)
    // kaybedilen yanal hızın bir kısmı ileriye aktarılır (arcade drift)
    if (fwd > 0) this.v.addScaledVector(this.f, Math.abs(lost) * (this.drifting ? 0.55 : 0.25))
    this.slip = side

    // hareket
    this.p.addScaledVector(this.v, DT)

    // duvarlar
    const loc2 = tr.track(this.p, this.idx)
    tr.frameAt(loc2.i, loc2.f, fr)
    const d2 = tmp.copy(this.p).sub(fr.p).dot(fr.r)
    const lim = fr.w / 2 - CAR.halfWidth
    if (tr.wall[loc2.i] && Math.abs(d2) > lim) {
      const s = Math.sign(d2)
      this.p.addScaledVector(fr.r, -(Math.abs(d2) - lim) * s)
      const into = this.v.dot(fr.r) * s
      if (into > 0) {
        this.v.addScaledVector(fr.r, -into * s * 1.25)
        this.v.multiplyScalar(Math.max(0.75, 1 - into * 0.012))
        // burnu duvardan uzaklaştır
        this.f.addScaledVector(fr.r, -s * Math.min(0.35, into * 0.03)).normalize()
      }
    }
    this.idx = loc2.i
    this.frac = loc2.f

    // kopma: yüzey aracı tutamıyorsa havalan
    const vt = this.v.length()
    const k = tr.K[loc2.i]
    const N = vt * vt * k - G.dot(fr.u) // yüzeyin uygulaması gereken normal ivme
    const adh = fr.u.y < 0.5 ? CAR.adhesion : 1.5
    if (N < -adh) {
      this.grounded = false
      this.airTime = 0
    }
  }

  private stepAir(inp: Input) {
    const tr = this.track
    const fr = this.fr
    this.airTime += DT
    this.onBoost = false
    this.drifting = false
    this.v.addScaledVector(G, DT)
    this.p.addScaledVector(this.v, DT)
    // havada araç yavaşça doğrulur; hafif yön kontrolü
    tmp.set(0, 1, 0)
    this.up.lerp(tmp, Math.min(1, 1.2 * DT)).normalize()
    this.f.applyAxisAngle(this.up, -inp.steer * 1.4 * DT)
    this.f.addScaledVector(this.up, -this.f.dot(this.up))
    if (this.f.lengthSq() < 1e-6) this.f.copy(tr.T[this.idx])
    this.f.normalize()

    const near = tr.nearest(this.p, this.idx - 25, this.idx + 160)
    if (near.dist < 40) this.idx = near.i
    // iniş denemesi: en yakın örneğin çevresinde
    for (const i of [near.i - 1, near.i, near.i + 1]) {
      if (i < 0 || i >= tr.count - 1) continue
      if (!tr.surface[i] || !tr.surface[i + 1]) continue
      tmp.copy(this.p).sub(tr.P[i])
      const f = Math.max(0, Math.min(1, tmp.dot(tr.T[i])))
      tr.frameAt(i, f, fr)
      tmp.copy(this.p).sub(fr.p)
      const h = tmp.dot(fr.u)
      const d = tmp.dot(fr.r)
      const along = tmp.dot(fr.t)
      if (Math.abs(along) > 1.5) continue
      const vn = this.v.dot(fr.u)
      if (Math.abs(d) < fr.w / 2 + 0.3 && h < 0.15 && h > -2.5 && vn <= 1) {
        this.grounded = true
        this.idx = i
        this.landed = Math.max(0, -vn)
        // sert inişte biraz hız kaybı
        this.v.addScaledVector(fr.u, -vn)
        if (this.landed > 12) this.v.multiplyScalar(0.92)
        this.p.copy(fr.p).addScaledVector(fr.r, d)
        this.up.copy(fr.u)
        this.f.addScaledVector(fr.u, -this.f.dot(fr.u)).normalize()
        this.airTime = 0
        return
      }
    }
    if (this.p.y < tr.minY - 30 || this.airTime > 8) this.fell = true
  }

  /** çizim için yön dörtlüsü */
  quaternion(out: Quaternion) {
    // Three: nesnenin -Z'si ileri. Sütunlar: X=sağ, Y=yukarı, Z=geri
    right.copy(this.f).cross(this.up).normalize()
    const back = tmp.copy(right).cross(this.up).normalize()
    tmp2.copy(back).cross(right).normalize() // dik yukarı
    m4.makeBasis(right, tmp2, back)
    return out.setFromRotationMatrix(m4)
  }
}

const m4 = new Matrix4()
