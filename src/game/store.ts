// Kişisel en iyi süreler ve hayaletler (localStorage).
import { LEVELS } from '../sim/tracks'
import { MEDALS } from '../sim/medals'

export interface Best {
  time: number
  ghost: string // base64 Float32
  cps: number[]
}

const KEY = 'rr.best.'

export function loadBest(trackId: string): Best | null {
  try {
    const s = localStorage.getItem(KEY + trackId)
    return s ? (JSON.parse(s) as Best) : null
  } catch {
    return null
  }
}

/** daha iyiyse kaydeder; yeni rekor mu döner */
export function saveIfBest(trackId: string, time: number, ghost: number[], cps: number[]): boolean {
  const old = loadBest(trackId)
  if (old && old.time <= time) return false
  try {
    localStorage.setItem(KEY + trackId, JSON.stringify({ time, ghost: packGhost(ghost), cps } satisfies Best))
  } catch {
    // yer dolarsa hayaletsiz kaydet
    localStorage.setItem(KEY + trackId, JSON.stringify({ time, ghost: '', cps }))
  }
  return true
}

export function packGhost(data: number[]): string {
  const f = new Float32Array(data)
  const bytes = new Uint8Array(f.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function unpackGhost(s: string): Float32Array {
  if (!s) return new Float32Array()
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export type Medal = 0 | 1 | 2 | 3 // yok, bronz, gümüş, altın

export function medalFor(trackId: string, time: number | undefined): Medal {
  const m = MEDALS[trackId]
  if (!m || time == null) return 0
  if (time <= m[0]) return 3
  if (time <= m[1]) return 2
  if (time <= m[2]) return 1
  return 0
}

/** bölüm i açık mı: ilk bölüm açık; sonrakiler bir öncekinden en az bronz ister */
export function isUnlocked(i: number): boolean {
  if (i === 0 || localStorage.getItem('rr.hepsiAcik') === '1') return true
  const prev = LEVELS[i - 1]
  return medalFor(prev.id, loadBest(prev.id)?.time) >= 1
}

export function fmt(ms: number, sign = false): string {
  const neg = ms < 0
  ms = Math.abs(Math.round(ms))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  const body = `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`
  return sign ? (neg ? '−' : '+') + body : body
}

export function getName(): string {
  return localStorage.getItem('rr.ad') || ''
}
export function setName(n: string) {
  localStorage.setItem('rr.ad', n.slice(0, 16))
}
export function getColor(): string {
  return localStorage.getItem('rr.renk') || CAR_COLORS[0]
}
export function setColor(c: string) {
  localStorage.setItem('rr.renk', c)
}

export const CAR_COLORS = ['#ffb300', '#ff5d73', '#3ad1c4', '#8b7bff', '#9ef06b', '#ff8a3d', '#f5f0e6', '#4aa3ff']
