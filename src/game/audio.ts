// WebAudio ile üretilen sesler: motor, bip, kontrol noktası. Dosya yok.
export class Sfx {
  private ctx?: AudioContext
  private osc?: OscillatorNode
  private osc2?: OscillatorNode
  private gain?: GainNode
  private filter?: BiquadFilterNode
  muted = localStorage.getItem('rr.sessiz') === '1'

  /** kullanıcı etkileşiminden sonra çağrılmalı */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
    } catch {
      return
    }
    const c = this.ctx
    this.gain = c.createGain()
    this.gain.gain.value = 0
    this.filter = c.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 700
    this.osc = c.createOscillator()
    this.osc.type = 'sawtooth'
    this.osc2 = c.createOscillator()
    this.osc2.type = 'square'
    const g2 = c.createGain()
    g2.gain.value = 0.35
    this.osc.connect(this.filter)
    this.osc2.connect(g2).connect(this.filter)
    this.filter.connect(this.gain).connect(c.destination)
    this.osc.start()
    this.osc2.start()
  }

  setMuted(m: boolean) {
    this.muted = m
    localStorage.setItem('rr.sessiz', m ? '1' : '0')
    if (m) this.engine(0, 0, false)
  }

  engine(speed: number, throttle: number, active: boolean) {
    if (!this.ctx || !this.osc || !this.gain || !this.osc2 || !this.filter) return
    const t = this.ctx.currentTime
    const on = active && !this.muted
    const f = 55 + Math.min(speed, 90) * 2.6
    this.osc.frequency.setTargetAtTime(f, t, 0.05)
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05)
    this.filter.frequency.setTargetAtTime(500 + throttle * 900 + speed * 8, t, 0.08)
    this.gain.gain.setTargetAtTime(on ? 0.045 + throttle * 0.03 : 0, t, 0.1)
  }

  beep(freq = 660, dur = 0.12, type: OscillatorType = 'triangle', vol = 0.12) {
    if (!this.ctx || this.muted) return
    const c = this.ctx
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur)
    o.connect(g).connect(c.destination)
    o.start()
    o.stop(c.currentTime + dur + 0.02)
  }

  checkpoint() {
    this.beep(880, 0.1)
    setTimeout(() => this.beep(1320, 0.14), 70)
  }

  finish() {
    ;[660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.18), i * 90))
  }
}
