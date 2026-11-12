// Pist: parça listesinden (segment) örneklenmiş bir şerit üretir.
// Fizik ve çizim aynı örnekleri kullanır; Three.js yalnızca vektör matematiği için.
import { Vector3 } from 'three'

/** Pist parçaları. Açılar derece, uzunluklar metre.
 *  s: düz · c: viraj (a>0 sola) · p: eğim değişimi (a>0 yukarı) · gap: boşluk (sıçrama)
 *  loop: döngü · cp: kontrol noktası
 *  c.y: viraj boyunca tırmanış (m, sarmal için)
 *  bank: yatış (s/p'de işaretli, + sola yatar; c'de büyüklük, yönü virajdan) · w: genişlik
 *  boost: hız şeridi · open: kenar duvarı yok */
export type Seg =
  | { t: 's'; l: number; bank?: number; w?: number; boost?: boolean; open?: boolean; g?: Zemin }
  | { t: 'c'; a: number; r: number; y?: number; bank?: number; w?: number; boost?: boolean; open?: boolean; g?: Zemin }
  | { t: 'p'; a: number; l: number; bank?: number; w?: number; boost?: boolean; open?: boolean; g?: Zemin }
  | { t: 'gap'; l: number; drop?: number }
  | { t: 'loop'; r: number; side?: number }
  | { t: 'cp' }

/** yüzey: asfalt (varsayılan), buz, toprak */
export type Zemin = 'buz' | 'toprak'
export type Tema = 'kanyon' | 'buzul' | 'gece'
export const GRIP: Record<string, number> = { asfalt: 1, buz: 0.42, toprak: 0.72 }

export interface TrackDef {
  tema?: Tema
  id: string
  name: string
  width?: number
  segs: Seg[]
  /** altın, gümüş, bronz (ms) */
  medals?: [number, number, number]
  sky?: number
}

export const DS = 1 // örnek aralığı (m)
const D2R = Math.PI / 180

export interface Frame {
  p: Vector3
  t: Vector3
  u: Vector3
  r: Vector3
  w: number
}

export class Track {
  def: TrackDef
  P: Vector3[] = []
  T: Vector3[] = []
  U: Vector3[] = []
  R: Vector3[] = []
  W: number[] = []
  surface: boolean[] = []
  wall: boolean[] = []
  boost: boolean[] = []
  grip: number[] = []
  zemin: (Zemin | null)[] = []
  K: number[] = [] // normal yöndeki eğrilik (+: yüzey yukarı kıvrılıyor)
  cps: number[] = []
  finish = 0
  /** aracın başladığı örnek (önünde start kapısı) */
  start = 0
  minY = 0
  maxY = 0
  bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }

  constructor(def: TrackDef) {
    this.def = def
    this.build()
  }

  get count() {
    return this.P.length
  }

  private build() {
    const def = this.def
    const P = new Vector3(0, 0, 0)
    const T = new Vector3(0, 0, -1)
    const U = new Vector3(0, 1, 0)
    const R = new Vector3(1, 0, 0)
    let bank = 0
    let width = def.width ?? 14
    const tmpU = new Vector3()
    const tmpR = new Vector3()

    let zemin: Zemin | null = null
    const push = (surface: boolean, wall: boolean, boost: boolean) => {
      this.grip.push(zemin ? GRIP[zemin] : 1)
      this.zemin.push(zemin)
      // yüzey çerçevesi = taban çerçevenin T etrafında yatırılmışı (+bank sola yatar)
      tmpU.copy(U).applyAxisAngle(T, -bank * D2R)
      tmpR.copy(T).cross(tmpU).normalize()
      this.P.push(P.clone())
      this.T.push(T.clone())
      this.U.push(tmpU.clone())
      this.R.push(tmpR.clone())
      this.W.push(width)
      this.surface.push(surface)
      this.wall.push(wall)
      this.boost.push(boost)
    }

    const smooth = (x: number) => x * x * (3 - 2 * x)

    // başlangıç düzlüğü (aracın ve kameranın arkasında da yol olsun)
    push(true, true, false)
    for (let i = 0; i < 24; i++) {
      P.addScaledVector(T, DS)
      push(true, true, false)
    }
    this.start = this.P.length - 1

    const segs: Seg[] = [...def.segs, { t: 's', l: 90 }] // bitişten sonra yavaşlama alanı
    let finishMarked = false
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si]
      if (si === segs.length - 1 && !finishMarked) {
        this.finish = this.P.length - 1
        finishMarked = true
      }
      if (s.t === 'cp') {
        this.cps.push(this.P.length - 1)
        continue
      }
      zemin = null
      if (s.t === 'gap') {
        // çerçeveyi düzle: boşlukta yön yataydır
        T.y = 0
        T.normalize()
        U.set(0, 1, 0)
        R.copy(T).cross(U).normalize()
        bank = 0
        const n = Math.max(1, Math.ceil(s.l / DS))
        const drop = s.drop ?? 0
        for (let i = 0; i < n; i++) {
          P.addScaledVector(T, s.l / n)
          P.y -= drop / n
          push(false, false, false)
        }
        continue
      }
      if (s.t === 'loop') {
        const len = 2 * Math.PI * s.r
        const n = Math.ceil(len / DS)
        const shift = (s.side ?? 1) * (width + 4)
        const startBank = bank
        for (let i = 0; i < n; i++) {
          const da = (2 * Math.PI) / n
          T.applyAxisAngle(R, da / 2)
          U.applyAxisAngle(R, da / 2)
          P.addScaledVector(T, len / n)
          T.applyAxisAngle(R, da / 2)
          U.applyAxisAngle(R, da / 2)
          const k = (i + 1) / n
          // yanal kaydırma: giriş ve çıkış üst üste binmesin
          const prevK = i / n
          P.addScaledVector(R, shift * (smooth(k) - smooth(prevK)))
          bank = startBank * (1 - k)
          push(true, true, false)
        }
        orthonormalize(T, U, R)
        continue
      }
      const wall = !s.open
      zemin = s.g ?? null
      const boost = !!s.boost
      const w0 = width
      const w1 = s.w ?? width
      if (s.t === 's') {
        const n = Math.max(1, Math.ceil(s.l / DS))
        const b0 = bank
        const b1 = s.bank ?? 0
        for (let i = 0; i < n; i++) {
          const k = smooth((i + 1) / n)
          P.addScaledVector(T, s.l / n)
          bank = b0 + (b1 - b0) * k
          width = w0 + (w1 - w0) * k
          push(true, wall, boost)
        }
      } else if (s.t === 'c') {
        const len = Math.abs(s.a) * D2R * s.r
        const n = Math.max(1, Math.ceil(len / DS))
        const b0 = bank
        const bt = Math.sign(s.a) * (s.bank ?? 0)
        for (let i = 0; i < n; i++) {
          const da = (s.a * D2R) / n
          T.applyAxisAngle(U, da / 2)
          R.applyAxisAngle(U, da / 2)
          P.addScaledVector(T, len / n)
          T.applyAxisAngle(U, da / 2)
          R.applyAxisAngle(U, da / 2)
          const k = (i + 1) / n
          if (s.y) P.y += s.y * (smooth(k) - smooth(i / n))
          // yatış girişte kurulur, çıkışta sıfıra döner
          const kin = smooth(Math.min(1, k / 0.3))
          const kout = smooth(Math.min(1, (1 - k) / 0.3))
          bank = k < 0.5 ? b0 + (bt - b0) * kin : bt * kout
          width = w0 + (w1 - w0) * smooth(k)
          push(true, wall, boost)
        }
        orthonormalize(T, U, R)
      } else if (s.t === 'p') {
        const n = Math.max(1, Math.ceil(s.l / DS))
        const b0 = bank
        const b1 = s.bank ?? 0
        for (let i = 0; i < n; i++) {
          const da = (s.a * D2R) / n
          T.applyAxisAngle(R, da / 2)
          U.applyAxisAngle(R, da / 2)
          P.addScaledVector(T, s.l / n)
          T.applyAxisAngle(R, da / 2)
          U.applyAxisAngle(R, da / 2)
          const k = smooth((i + 1) / n)
          bank = b0 + (b1 - b0) * k
          width = w0 + (w1 - w0) * k
          push(true, wall, boost)
        }
        orthonormalize(T, U, R)
      }
    }

    // eğrilik
    const n = this.P.length
    for (let i = 0; i < n; i++) {
      const a = this.T[Math.max(0, i - 1)]
      const b = this.T[Math.min(n - 1, i + 1)]
      const span = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * DS
      const dT = b.clone().sub(a)
      this.K.push(span > 0 ? dT.dot(this.U[i]) / span : 0)
    }

    let minY = Infinity,
      maxY = -Infinity,
      minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity
    for (const p of this.P) {
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
    this.minY = minY
    this.maxY = maxY
    this.bounds = { minX, maxX, minZ, maxZ }
  }

  /** i ve i+1 arasında f oranında enterpole çerçeve */
  frameAt(i: number, f: number, out: Frame) {
    const n = this.P.length
    i = Math.max(0, Math.min(n - 1, i))
    const j = Math.min(n - 1, i + 1)
    out.p.copy(this.P[i]).lerp(this.P[j], f)
    out.t.copy(this.T[i]).lerp(this.T[j], f).normalize()
    out.u.copy(this.U[i]).lerp(this.U[j], f).normalize()
    out.r.copy(this.R[i]).lerp(this.R[j], f).normalize()
    out.w = this.W[i] + (this.W[j] - this.W[i]) * f
    return out
  }

  /** Bir noktayı ipucu çevresinde parça boyunca ilerleyerek izler (yer temasında). */
  track(p: Vector3, hint: number): { i: number; f: number } {
    const n = this.P.length
    let i = Math.max(0, Math.min(n - 2, hint))
    const tmp = new Vector3()
    for (let guard = 0; guard < 64; guard++) {
      if (i < n - 2 && tmp.copy(p).sub(this.P[i + 1]).dot(this.T[i + 1]) > 0) i++
      else if (i > 0 && tmp.copy(p).sub(this.P[i]).dot(this.T[i]) < 0) i--
      else break
    }
    const f = Math.max(0, Math.min(1, tmp.copy(p).sub(this.P[i]).dot(this.T[i]) / DS))
    return { i, f }
  }

  /** Pencere içinde en yakın örnek (havadayken). */
  nearest(p: Vector3, lo: number, hi: number): { i: number; dist: number } {
    const n = this.P.length
    lo = Math.max(0, lo)
    hi = Math.min(n - 1, hi)
    let best = lo,
      bd = Infinity
    for (let i = lo; i <= hi; i++) {
      const d = this.P[i].distanceToSquared(p)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return { i: best, dist: Math.sqrt(bd) }
  }
}

function orthonormalize(T: Vector3, U: Vector3, R: Vector3) {
  T.normalize()
  R.copy(T).cross(U).normalize()
  U.copy(R).cross(T).normalize()
}

/** Pist paylaşma kodu: JSON → base64url */
export function encodeTrack(def: TrackDef): string {
  const json = JSON.stringify({ n: def.name, w: def.width, s: def.segs })
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeTrack(code: string): TrackDef | null {
  try {
    const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const o = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(o.s) || o.s.length > 400) return null
    const segs: Seg[] = o.s.filter((s: Seg) => s && typeof s.t === 'string')
    return { id: 'ozel-' + hash(code), name: String(o.n || 'Özel pist').slice(0, 40), width: Number(o.w) || 14, segs }
  } catch {
    return null
  }
}

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
