// P2P lobi: sunucu yok. Oda sahibi lobinin durumunu tutar ve yayınlar (Trystero, Nostr sinyali).
import { joinRoom, selfId, type Room } from 'trystero'

export const APP_ID = 'ruzgar-rotasi-yaris-v1'

export type Player = {
  id: string
  name: string
  color: string
  time: number | null // bitiş süresi
  cp: number // geçilen kontrol noktası (canlı sıralama için)
  progress: number // pist örneği
}

export type Phase = 'lobby' | 'countdown' | 'race' | 'results'

export type LobbyState = {
  hostId: string
  phase: Phase
  trackId: string
  trackCode: string // özel pist ise kodu
  raceId: number
  players: Player[]
}

/** pos paketi: x,y,z,qx,qy,qz,qw,steer,speed,progress,cp */
export type PosPacket = number[]

const ALPHABET = 'ABCDEFGHJKLMNPRSTUVYZ23456789'
export function makeCode() {
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(5))
  for (const b of r) s += ALPHABET[b % ALPHABET.length]
  return s
}

export class Lobby {
  room: Room
  readonly selfId = selfId
  state: LobbyState
  private sendHello: (d: Hello, to?: string) => void
  private sendState: (d: LobbyState) => void
  private sendPos: (d: PosPacket) => void
  private sendFin: (d: { raceId: number; time: number }) => void
  private sendGo: (d: { raceId: number; delay: number }) => void
  private known = new Map<string, Hello>()
  private resultTimer = 0
  onState?: (s: LobbyState) => void
  onPos?: (id: string, p: PosPacket) => void
  onGo?: (delay: number, raceId: number) => void
  onLeave?: (id: string) => void
  onPeerCount?: (n: number) => void

  constructor(
    public code: string,
    host: boolean,
    public me: { name: string; color: string },
    trackId: string,
  ) {
    this.room = joinRoom({ appId: APP_ID }, 'oda-' + code)
    this.state = {
      hostId: host ? selfId : '',
      phase: 'lobby',
      trackId,
      trackCode: '',
      raceId: 0,
      players: [{ id: selfId, name: me.name, color: me.color, time: null, cp: 0, progress: 0 }],
    }
    this.known.set(selfId, me)

    const hello = this.room.makeAction<Hello>('merhaba')
    const state = this.room.makeAction<LobbyState>('durum')
    const pos = this.room.makeAction<PosPacket>('konum')
    const fin = this.room.makeAction<{ raceId: number; time: number }>('bitis')
    const go = this.room.makeAction<{ raceId: number; delay: number }>('basla')
    this.sendHello = (d, to) => void hello.send(d, to ? { target: to } : undefined).catch(() => {})
    this.sendState = (d) => void state.send(d).catch(() => {})
    this.sendPos = (d) => void pos.send(d).catch(() => {})
    this.sendFin = (d) => void fin.send(d).catch(() => {})
    this.sendGo = (d) => void go.send(d).catch(() => {})

    this.room.onPeerJoin = (id) => {
      this.sendHello(this.me, id)
      if (this.isHost) this.broadcast()
      this.onPeerCount?.(Object.keys(this.room.getPeers()).length)
    }
    this.room.onPeerLeave = (id) => {
      this.known.delete(id)
      const wasHost = id === this.state.hostId
      this.state.players = this.state.players.filter((p) => p.id !== id)
      if (wasHost) {
        // oda sahibi ayrıldı: kalanlar arasında kimliği en küçük olan devralır
        const ids = [selfId, ...Object.keys(this.room.getPeers())].sort()
        this.state.hostId = ids[0]
        if (this.state.phase !== 'lobby') this.state.phase = 'results'
      }
      if (this.isHost) this.broadcast()
      else this.onState?.(this.state)
      this.onLeave?.(id)
      this.onPeerCount?.(Object.keys(this.room.getPeers()).length)
    }
    hello.onMessage = (d, ctx) => {
      this.known.set(ctx.peerId, { name: String(d.name).slice(0, 16), color: String(d.color).slice(0, 9) })
      if (this.isHost) {
        this.upsert(ctx.peerId)
        this.broadcast()
      }
    }
    state.onMessage = (d, ctx) => {
      // yalnızca oda sahibinden gelen durum geçerli
      if (d.hostId !== ctx.peerId) return
      if (this.isHost && ctx.peerId !== selfId && selfId < ctx.peerId) return
      this.state = d
      this.onState?.(d)
    }
    pos.onMessage = (d, ctx) => {
      if (!Array.isArray(d) || d.length < 11) return
      this.onPos?.(ctx.peerId, d)
      if (this.isHost) {
        const p = this.state.players.find((x) => x.id === ctx.peerId)
        if (p) {
          p.progress = d[9]
          p.cp = d[10]
        }
      }
    }
    fin.onMessage = (d, ctx) => {
      if (!this.isHost || d.raceId !== this.state.raceId) return
      this.recordFinish(ctx.peerId, d.time)
    }
    go.onMessage = (d, ctx) => {
      if (ctx.peerId !== this.state.hostId) return
      this.onGo?.(d.delay, d.raceId)
    }
  }

  get isHost() {
    return this.state.hostId === selfId
  }

  get peerCount() {
    return Object.keys(this.room.getPeers()).length
  }

  private upsert(id: string) {
    const h = this.known.get(id)
    if (!h) return
    let p = this.state.players.find((x) => x.id === id)
    if (!p) {
      p = { id, name: h.name, color: h.color, time: null, cp: 0, progress: 0 }
      this.state.players.push(p)
    }
    p.name = h.name
    p.color = h.color
  }

  broadcast() {
    if (!this.isHost) return
    for (const id of this.known.keys()) this.upsert(id)
    this.sendState(this.state)
    this.onState?.(this.state)
  }

  // ------------------------------------------------ oda sahibi işlemleri
  setTrack(trackId: string, trackCode = '') {
    if (!this.isHost || this.state.phase === 'race' || this.state.phase === 'countdown') return
    this.state.trackId = trackId
    this.state.trackCode = trackCode
    this.state.phase = 'lobby'
    this.broadcast()
  }

  startRace(delay = 3500) {
    if (!this.isHost) return
    this.state.raceId++
    this.state.phase = 'countdown'
    for (const p of this.state.players) {
      p.time = null
      p.cp = 0
      p.progress = 0
    }
    this.broadcast()
    this.sendGo({ raceId: this.state.raceId, delay })
    this.onGo?.(delay, this.state.raceId)
    clearTimeout(this.resultTimer)
    setTimeout(() => {
      if (this.state.phase === 'countdown') {
        this.state.phase = 'race'
        this.broadcast()
      }
    }, delay)
  }

  backToLobby() {
    if (!this.isHost) return
    clearTimeout(this.resultTimer)
    this.state.phase = 'lobby'
    this.broadcast()
  }

  // ------------------------------------------------ herkes
  pos(p: PosPacket) {
    this.sendPos(p)
  }

  finish(time: number) {
    if (this.isHost) this.recordFinish(selfId, time)
    else this.sendFin({ raceId: this.state.raceId, time })
  }

  private recordFinish(id: string, time: number) {
    const p = this.state.players.find((x) => x.id === id)
    if (!p || p.time != null) return
    p.time = time
    const all = this.state.players.every((x) => x.time != null)
    if (all) this.state.phase = 'results'
    else if (!this.resultTimer) {
      // ilk bitirenden 45 sn sonra yarış kapanır
      this.resultTimer = window.setTimeout(() => {
        this.resultTimer = 0
        if (this.state.phase === 'race') {
          this.state.phase = 'results'
          this.broadcast()
        }
      }, 45000)
    }
    if (all) {
      clearTimeout(this.resultTimer)
      this.resultTimer = 0
    }
    this.broadcast()
  }

  leave() {
    clearTimeout(this.resultTimer)
    void this.room.leave()
  }
}

type Hello = {
  name: string
  color: string
}
