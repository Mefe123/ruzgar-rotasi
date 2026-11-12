// Basit pist atölyesi: hazır parçaları sırayla ekle, önizle, sür, kodla paylaş.
import { encodeTrack, decodeTrack, hash, type Seg, type TrackDef } from '../sim/track'

interface Block {
  label: string
  segs: Seg[]
}

const PALETTE: Block[] = [
  { label: 'Düz 30 m', segs: [{ t: 's', l: 30 }] },
  { label: 'Uzun düz', segs: [{ t: 's', l: 70 }] },
  { label: 'Hız şeridi', segs: [{ t: 's', l: 25, boost: true }] },
  { label: 'Sol viraj', segs: [{ t: 'c', a: 90, r: 40, bank: 12 }] },
  { label: 'Sağ viraj', segs: [{ t: 'c', a: -90, r: 40, bank: 12 }] },
  { label: 'Hafif sol', segs: [{ t: 'c', a: 35, r: 60 }] },
  { label: 'Hafif sağ', segs: [{ t: 'c', a: -35, r: 60 }] },
  { label: 'Keskin sol', segs: [{ t: 'c', a: 160, r: 20, bank: 10 }] },
  { label: 'Keskin sağ', segs: [{ t: 'c', a: -160, r: 20, bank: 10 }] },
  { label: 'Tepe', segs: [{ t: 'p', a: 10, l: 30 }, { t: 'p', a: -10, l: 30 }] },
  { label: 'Çukur', segs: [{ t: 'p', a: -10, l: 30 }, { t: 'p', a: 10, l: 30 }] },
  {
    label: 'Sıçrama',
    segs: [
      { t: 's', l: 30 },
      { t: 'p', a: 6, l: 10 },
      { t: 'gap', l: 26, drop: 1 },
      { t: 'p', a: -4, l: 20 },
      { t: 'p', a: 4, l: 20 },
      { t: 's', l: 60 },
    ],
  },
  { label: 'Döngü', segs: [{ t: 's', l: 20, boost: true }, { t: 'loop', r: 14 }] },
  {
    label: 'Sol duvar',
    segs: [
      { t: 's', l: 18, bank: -60 },
      { t: 's', l: 40, bank: -60 },
      { t: 's', l: 18 },
    ],
  },
  {
    label: 'Sağ duvar',
    segs: [
      { t: 's', l: 18, bank: 60 },
      { t: 's', l: 40, bank: 60 },
      { t: 's', l: 18 },
    ],
  },
  { label: 'Dar köprü', segs: [{ t: 's', l: 35, w: 9, open: true }, { t: 's', l: 15, w: 14 }] },
  { label: 'Buzlu düz', segs: [{ t: 's', l: 40, g: 'buz' }] },
  { label: 'Toprak viraj', segs: [{ t: 'c', a: 90, r: 30, g: 'toprak' }] },
  { label: 'Kontrol', segs: [{ t: 'cp' }] },
]

const DEFAULT: Block[] = [PALETTE[1], PALETTE[3], PALETTE[2], PALETTE[16], PALETTE[9], PALETTE[4], PALETTE[0]]

export class Editor {
  private blocks: Block[] = []
  private nameEl = document.getElementById('ed-ad') as HTMLInputElement
  private listEl = document.getElementById('parca-listesi')!
  private msgEl = document.getElementById('ed-mesaj')!
  private timer = 0

  constructor(
    private cb: {
      onPreview: (def: TrackDef) => void
      onDrive: (def: TrackDef) => void
      toast: (m: string) => void
    },
  ) {
    try {
      const saved = localStorage.getItem('rr.atolye')
      const d = saved ? decodeTrack(saved) : null
      if (d) this.fromDef(d)
      else this.blocks = [...DEFAULT]
    } catch {
      this.blocks = [...DEFAULT]
    }
    const pal = document.getElementById('parca-paleti')!
    for (const b of PALETTE) {
      const btn = document.createElement('button')
      btn.textContent = '+ ' + b.label
      btn.onclick = () => {
        if (this.blocks.length >= 60) return this.msg('En çok 60 parça')
        this.blocks.push(b)
        this.changed()
        this.listEl.lastElementChild?.scrollIntoView({ block: 'nearest' })
      }
      pal.append(btn)
    }
    document.getElementById('ed-sur')!.onclick = () => {
      const def = this.def()
      if (!def.segs.some((s) => s.t !== 'cp')) return this.msg('Önce birkaç parça ekle')
      this.cb.onDrive(def)
    }
    document.getElementById('ed-kopyala')!.onclick = async () => {
      const code = encodeTrack(this.def())
      try {
        await navigator.clipboard.writeText(code)
        this.cb.toast('Pist kodu kopyalandı')
      } catch {
        ;(document.getElementById('ed-kod') as HTMLInputElement).value = code
        this.msg('Kopyalanamadı; kod aşağıdaki kutuda')
      }
    }
    document.getElementById('ed-temizle')!.onclick = () => {
      this.blocks = []
      this.changed()
    }
    document.getElementById('ed-yukle')!.onclick = () => {
      const inp = document.getElementById('ed-kod') as HTMLInputElement
      const d = decodeTrack(inp.value)
      if (!d) return this.msg('Kod okunamadı')
      this.fromDef(d)
      this.changed()
      this.msg('')
    }
    this.nameEl.oninput = () => this.save()
  }

  open() {
    this.render()
    this.cb.onPreview(this.def())
  }

  private fromDef(d: TrackDef) {
    this.nameEl.value = d.name
    this.blocks = d.segs.map((s) => ({ label: describe(s), segs: [s] }))
  }

  def(): TrackDef {
    const segs = this.blocks.flatMap((b) => b.segs)
    const name = this.nameEl.value.trim() || 'Özel pist'
    const code = encodeTrack({ id: '', name, segs, width: 14 })
    return { id: 'ozel-' + hash(code), name, width: 14, segs }
  }

  private msg(m: string) {
    this.msgEl.textContent = m
  }

  private save() {
    localStorage.setItem('rr.atolye', encodeTrack(this.def()))
  }

  private changed() {
    this.render()
    this.save()
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.cb.onPreview(this.def()), 150)
  }

  private render() {
    this.listEl.innerHTML = ''
    this.blocks.forEach((b, i) => {
      const li = document.createElement('li')
      li.textContent = b.label
      const del = document.createElement('button')
      del.textContent = 'sil'
      del.setAttribute('aria-label', b.label + ' parçasını sil')
      del.onclick = () => {
        this.blocks.splice(i, 1)
        this.changed()
      }
      li.append(del)
      this.listEl.append(li)
    })
  }
}

function describe(s: Seg): string {
  switch (s.t) {
    case 's':
      return s.boost ? 'Hız şeridi' : s.bank ? `Yatık düz (${s.bank}°)` : s.open ? 'Açık düz' : `Düz ${s.l} m`
    case 'c':
      return `${s.a > 0 ? 'Sol' : 'Sağ'} viraj ${Math.abs(s.a)}°`
    case 'p':
      return s.a > 0 ? 'Yokuş yukarı' : 'Yokuş aşağı'
    case 'gap':
      return `Boşluk ${s.l} m`
    case 'loop':
      return 'Döngü'
    case 'cp':
      return 'Kontrol'
  }
}
