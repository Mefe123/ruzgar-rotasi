// Klavye + dokunmatik giriş. Direksiyon klavyede yumuşatılır.
import type { Input } from '../sim/car'

type Action = 'restart' | 'respawn' | 'pause'

export class Controls {
  private keys = new Set<string>()
  private touch = { left: false, right: false, gas: false, brake: false, drift: false }
  private steer = 0
  enabled = true
  onAction?: (a: Action) => void

  constructor() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      const k = e.code
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault()
      if (!e.repeat) {
        if (k === 'KeyR') this.onAction?.('restart')
        if (k === 'Backspace' || k === 'Enter' || k === 'KeyC') this.onAction?.('respawn')
        if (k === 'Escape' || k === 'KeyP') this.onAction?.('pause')
      }
      this.keys.add(k)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  /** dokunmatik düğmeleri bağla: data-tus="left|right|gas|brake|drift|restart|respawn|pause" */
  bindTouch(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-tus]').forEach((el) => {
      const name = el.dataset.tus as keyof Controls['touch'] | Action
      const set = (v: boolean) => {
        if (name in this.touch) (this.touch as Record<string, boolean>)[name] = v
        el.classList.toggle('basili', v)
      }
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        if (name === 'restart' || name === 'respawn' || name === 'pause') this.onAction?.(name)
        else set(true)
      })
      const up = () => set(false)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('lostpointercapture', up)
      el.addEventListener('contextmenu', (e) => e.preventDefault())
    })
  }

  read(dt: number): Input {
    const k = this.keys
    const t = this.touch
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, drift: false }
    const left = k.has('ArrowLeft') || k.has('KeyA') || t.left
    const right = k.has('ArrowRight') || k.has('KeyD') || t.right
    const target = (right ? 1 : 0) - (left ? 1 : 0)
    // yumuşak direksiyon: basınca hızlı, bırakınca daha hızlı merkezlenir
    const rate = target === 0 ? 10 : Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 12 : 6
    const d = target - this.steer
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt)
    return {
      throttle: k.has('ArrowUp') || k.has('KeyW') || t.gas ? 1 : 0,
      brake: k.has('ArrowDown') || k.has('KeyS') || t.brake ? 1 : 0,
      steer: this.steer,
      drift: k.has('Space') || k.has('ShiftLeft') || t.drift,
    }
  }

  reset() {
    this.steer = 0
  }
}
