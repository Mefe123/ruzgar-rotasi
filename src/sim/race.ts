// Yarış oturumu: süre, kontrol noktaları, bitiş ve hayalet kaydı. Tarayıcıdan bağımsız.
import { Quaternion, Vector3 } from 'three'
import { CarSim, DT, type Input } from './car'
import { Track } from './track'

export const GHOST_EVERY = 3 // 120 Hz / 3 = 40 Hz kayıt

export interface CpEvent {
  index: number
  time: number
}

export class Race {
  car: CarSim
  steps = 0
  started = false
  finished = false
  finishTime = 0
  nextCp = 0
  cpTimes: number[] = []
  lastCp = -1
  private cpSpeed = 0
  ghost: number[] = [] // x,y,z,qx,qy,qz,qw ...
  private q = new Quaternion()
  private prevP = new Vector3()
  onCheckpoint?: (e: CpEvent) => void
  onFinish?: (time: number) => void
  onRespawn?: () => void

  constructor(public track: Track) {
    this.car = new CarSim(track)
    this.restart()
  }

  get time() {
    return this.finished ? this.finishTime : (this.steps * DT * 1000)
  }

  restart() {
    this.car.reset(this.track.start, 0)
    this.steps = 0
    this.started = false
    this.finished = false
    this.finishTime = 0
    this.nextCp = 0
    this.cpTimes = []
    this.lastCp = -1
    this.cpSpeed = 0
    this.ghost = []
  }

  /** başa dön, süre işlemeye devam eder (lobide) */
  toStart() {
    if (this.finished) return
    this.car.reset(this.track.start, 0)
    this.nextCp = 0
    this.lastCp = -1
    this.cpTimes = []
    this.onRespawn?.()
  }

  /** son kontrol noktasına dön (süre işlemeye devam eder) */
  respawn() {
    if (this.finished) return
    if (this.lastCp < 0) {
      this.car.reset(this.track.start, 0)
    } else {
      this.car.reset(this.track.cps[this.lastCp] + 1, this.cpSpeed)
    }
    this.onRespawn?.()
  }

  step(inp: Input) {
    if (!this.started) return
    const car = this.car
    this.prevP.copy(car.p)
    car.step(this.finished ? { throttle: 0, brake: 1, steer: 0, drift: false } : inp)
    if (this.finished) return
    this.steps++
    if (car.fell) {
      this.respawn()
      return
    }
    const tr = this.track
    // kontrol noktaları sırayla
    if (this.nextCp < tr.cps.length) {
      const ci = tr.cps[this.nextCp]
      if (this.crossed(ci)) {
        this.cpTimes.push(this.time)
        this.lastCp = this.nextCp
        this.cpSpeed = Math.max(0, Math.min(car.fwdSpeed, 70))
        this.onCheckpoint?.({ index: this.nextCp, time: this.time })
        this.nextCp++
      }
    } else if (this.crossed(tr.finish)) {
      // milisaniye hassasiyeti: düzlem geçişini adım içinde enterpole et
      const P = tr.P[tr.finish]
      const T = tr.T[tr.finish]
      const d0 = this.prevP.clone().sub(P).dot(T)
      const d1 = car.p.clone().sub(P).dot(T)
      const frac = d1 !== d0 ? Math.max(0, Math.min(1, -d0 / (d1 - d0))) : 1
      this.finishTime = Math.round((this.steps - 1 + frac) * DT * 1000)
      this.finished = true
      this.recordGhost(true)
      this.onFinish?.(this.finishTime)
      return
    }
    if (this.steps % GHOST_EVERY === 0) this.recordGhost()
  }

  /** araç bu örneğin düzlemini ileri yönde geçti mi (ve yakınında mı) */
  private crossed(i: number) {
    const tr = this.track
    const P = tr.P[i]
    const T = tr.T[i]
    const d0 = this.prevP.clone().sub(P).dot(T)
    const d1 = this.car.p.clone().sub(P).dot(T)
    if (!(d0 < 0 && d1 >= 0)) return false
    const lateral = this.car.p.clone().sub(P)
    lateral.addScaledVector(T, -lateral.dot(T))
    return lateral.length() < tr.W[i] / 2 + 6
  }

  private recordGhost(force = false) {
    if (!force && this.ghost.length > 7 * 40 * 60 * 10) return // 10 dk sınır
    const c = this.car
    c.quaternion(this.q)
    this.ghost.push(r2(c.p.x), r2(c.p.y), r2(c.p.z), r3(this.q.x), r3(this.q.y), r3(this.q.z), r3(this.q.w))
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Hayalet verisinden t (ms) anındaki konum ve dönüş */
export function sampleGhost(data: ArrayLike<number>, tMs: number, pos: Vector3, q: Quaternion): boolean {
  const frames = data.length / 7
  if (frames < 2) return false
  const fi = tMs / (DT * 1000 * GHOST_EVERY) - 1
  if (fi < 0) {
    pos.set(data[0], data[1], data[2])
    q.set(data[3], data[4], data[5], data[6])
    return true
  }
  const i = Math.floor(fi)
  if (i >= frames - 1) {
    const k = (frames - 1) * 7
    pos.set(data[k], data[k + 1], data[k + 2])
    q.set(data[k + 3], data[k + 4], data[k + 5], data[k + 6])
    return false
  }
  const f = fi - i
  const a = i * 7,
    b = a + 7
  pos.set(data[a], data[a + 1], data[a + 2]).lerp(tmpV.set(data[b], data[b + 1], data[b + 2]), f)
  q.set(data[a + 3], data[a + 4], data[a + 5], data[a + 6]).slerp(tmpQ.set(data[b + 3], data[b + 4], data[b + 5], data[b + 6]), f)
  return true
}
const tmpV = new Vector3()
const tmpQ = new Quaternion()

/** basit pilot: pistin ortasındaki ileri bir noktaya yönelir (ayar ve test için) */
export function botInput(race: Race, aggressive = 1): Input {
  const car = race.car
  const tr = race.track
  const look = Math.round(8 + Math.abs(car.fwdSpeed) * 0.35)
  const ti = Math.min(tr.count - 1, car.idx + look)
  const target = tr.P[ti].clone().sub(car.p)
  const up = car.up
  target.addScaledVector(up, -target.dot(up))
  const f = car.f
  const right = f.clone().cross(up).normalize()
  const x = target.dot(right)
  const z = target.dot(f)
  const ang = Math.atan2(x, Math.max(0.1, z))
  // önümüzdeki virajlara göre hedef hız: v ≈ dönüş hızı × yarıçap
  const v = car.fwdSpeed
  let mustBrake = false
  for (let k = 0; k < 90; k += 3) {
    const i = car.idx + k
    if (i + 6 >= tr.count) break
    const a0 = tr.T[i].clone().addScaledVector(tr.U[i], -tr.T[i].dot(tr.U[i])).normalize()
    const a1 = tr.T[i + 6].clone().addScaledVector(tr.U[i], -tr.T[i + 6].dot(tr.U[i])).normalize()
    const ang = Math.acos(Math.min(1, a0.dot(a1))) // yalnızca yatay kıvrım (döngü sayılmaz)
    if (ang < 1e-3) continue
    const r = 6 / ang
    const vlim = 1.3 * r * aggressive
    if (v > vlim && v * v - vlim * vlim > 2 * 30 * k) mustBrake = true
  }
  return {
    throttle: mustBrake ? 0 : 1,
    brake: mustBrake ? 1 : 0,
    steer: Math.max(-1, Math.min(1, ang * 2.5)),
    drift: false,
  }
}
