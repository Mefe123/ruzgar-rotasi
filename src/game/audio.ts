// WebAudio ile üretilen sesler: motor, bip, kontrol noktası. Dosya yok.
export class Sfx {
  private ctx?: AudioContext
  private osc?: OscillatorNode
  private osc2?: OscillatorNode
  private gain?: GainNode
  private filter?: BiquadFilterNode
  private skidGain?: GainNode
  private gear = 1
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
    // lastik sesi: süzülmüş gürültü
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = c.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1100
    bp.Q.value = 1.4
    this.skidGain = c.createGain()
    this.skidGain.gain.value = 0
    noise.connect(bp).connect(this.skidGain).connect(c.destination)
    noise.start()
  }

  setMuted(m: boolean) {
    this.muted = m
    localStorage.setItem('rr.sessiz', m ? '1' : '0')
    if (m) this.engine(0, 0, false)
  }

  /** vitesli motor: hız bantlarında devir yükselir, vites atınca düşer */
  engine(speed: number, throttle: number, active: boolean, skid = 0) {
    if (!this.ctx || !this.osc || !this.gear || !this.gain || !this.osc2 || !this.filter || !this.skidGain) return
    const t = this.ctx.currentTime
    const on = active && !this.muted
    const v = Math.abs(speed)
    const bands = [0, 14, 27, 40, 53, 66, 999]
    let g = this.gear
    while (g < 6 && v > bands[g] + 1.5) g++
    while (g > 1 && v < bands[g - 1] - 1.5) g--
    if (g !== this.gear) {
      this.gear = g
      // vites atışında kısa boşluk
      this.gain.gain.setTargetAtTime(0.015, t, 0.01)
    }
    const lo = bands[g - 1],
      hi = Math.min(bands[g], 80)
    const rpm = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
    const f = 70 + rpm * 150 + g * 12
    this.osc.frequency.setTargetAtTime(f, t, 0.03)
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03)
    this.filter.frequency.setTargetAtTime(600 + throttle * 1400 + rpm * 600, t, 0.05)
    this.gain.gain.setTargetAtTime(on ? 0.04 + throttle * 0.035 : 0, t, 0.06)
    const sk = on ? Math.min(0.09, Math.max(0, skid - 2.5) * 0.012) : 0
    this.skidGain.gain.setTargetAtTime(sk, t, 0.05)
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
