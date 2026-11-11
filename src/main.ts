import '@fontsource/unbounded/700.css'
import '@fontsource/unbounded/900.css'
import './style.css'
import * as THREE from 'three'
import { World } from './game/world'
import { makeCar, type CarView } from './game/carMesh'
import { Controls } from './game/input'
import { Sfx } from './game/audio'
import {
  CAR_COLORS,
  fmt,
  getColor,
  getName,
  isUnlocked,
  loadBest,
  medalFor,
  saveIfBest,
  setColor,
  setName,
  unpackGhost,
  type Best,
} from './game/store'
import { Lobby, makeCode, type LobbyState, type PosPacket } from './game/net'
import { Editor } from './game/editor'
import { Track, decodeTrack, type TrackDef } from './sim/track'
import { LEVELS } from './sim/tracks'
import { MEDALS } from './sim/medals'
import { Race, botInput, sampleGhost } from './sim/race'
import { DT, type Input } from './sim/car'

// ------------------------------------------------------------------ kurulum
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('sahne')
const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
const coarse = window.matchMedia('(pointer: coarse)').matches
const savedMotion = localStorage.getItem('rr.azHareket')
const settings = {
  reducedMotion: savedMotion != null ? savedMotion === '1' : mqReduce.matches,
  lowPower: coarse || (navigator.hardwareConcurrency ?? 8) <= 4,
}
document.documentElement.classList.toggle('az-hareket', settings.reducedMotion)
const world = new World(canvas, settings)
const controls = new Controls()
controls.bindTouch($('hud'))
const sfx = new Sfx()
window.addEventListener('pointerdown', () => sfx.unlock(), { once: false })
window.addEventListener('keydown', () => sfx.unlock())

type Mode = 'menu' | 'solo' | 'multi' | 'test'
let mode: Mode = 'menu'

interface Run {
  def: TrackDef
  track: Track
  race: Race
  player: CarView
  ghost?: CarView
  ghostData?: Float32Array
  best: Best | null
  level: number // -1: bölüm değil
}
let run: Run | null = null
let previewTrack: Track | null = null
let countdownEnd = 0
let lastCount = -1
let paused = false
let acc = 0
let pilot = new URLSearchParams(location.search).has('pilot')
const prevP = new THREE.Vector3()
const prevQ = new THREE.Quaternion()
const curQ = new THREE.Quaternion()
const drawP = new THREE.Vector3()
const drawQ = new THREE.Quaternion()
let lastInput: Input = { throttle: 0, brake: 0, steer: 0, drift: false }

// ------------------------------------------------------------------ ekran yönetimi
const screens = ['menu', 'bolumler', 'lobi', 'atolye']
function show(id: string) {
  for (const s of screens) $(s).classList.toggle('gizli', s !== id)
  if (id === 'bolumler') renderLevels()
  if (id === 'menu' || id === 'bolumler') setPreview(LEVELS[Math.min(LEVELS.length - 1, highestUnlocked())])
  if (id === 'atolye') editor.open()
}
document.querySelectorAll<HTMLElement>('[data-git]').forEach((b) => b.addEventListener('click', () => show(b.dataset.git!)))

function overlay(id: string | null) {
  for (const o of ['duraklat', 'bitis', 'sonuc']) $(o).classList.toggle('gizli', o !== id)
}

let toastTimer = 0
function toast(msg: string) {
  const el = $('bildirim')
  el.textContent = msg
  el.classList.add('goster')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('goster'), 2600)
}

function setPreview(def: TrackDef) {
  if (run) return
  if (previewTrack?.def === def) return
  previewTrack = new Track(def)
  world.setTrack(previewTrack)
}

function highestUnlocked() {
  let h = 0
  LEVELS.forEach((_, i) => {
    if (isUnlocked(i)) h = i
  })
  return h
}

// ------------------------------------------------------------------ menü: ad, renk, ayarlar
const nameInput = $<HTMLInputElement>('ad')
nameInput.value = getName()
nameInput.addEventListener('change', () => setName(nameInput.value.trim()))
function myName() {
  let n = nameInput.value.trim()
  if (!n) {
    n = 'Sürücü-' + Math.floor(100 + Math.random() * 900)
    nameInput.value = n
    setName(n)
  }
  return n
}
const colorsEl = $('renkler')
function renderColors() {
  colorsEl.innerHTML = ''
  for (const c of CAR_COLORS) {
    const b = document.createElement('button')
    b.style.background = c
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-label', 'Renk ' + c)
    b.setAttribute('aria-checked', String(c === getColor()))
    b.onclick = () => {
      setColor(c)
      renderColors()
    }
    colorsEl.append(b)
  }
}
renderColors()
const soundBox = $<HTMLInputElement>('ses')
soundBox.checked = !sfx.muted
soundBox.onchange = () => sfx.setMuted(!soundBox.checked)
const motionBox = $<HTMLInputElement>('hareket')
motionBox.checked = settings.reducedMotion
motionBox.onchange = () => {
  settings.reducedMotion = motionBox.checked
  localStorage.setItem('rr.azHareket', motionBox.checked ? '1' : '0')
  document.documentElement.classList.toggle('az-hareket', settings.reducedMotion)
}

// ------------------------------------------------------------------ bölüm listesi
function renderLevels() {
  const list = $('bolum-listesi')
  list.innerHTML = ''
  let gold = 0
  LEVELS.forEach((def, i) => {
    const best = loadBest(def.id)
    const medal = medalFor(def.id, best?.time)
    if (medal === 3) gold++
    const open = isUnlocked(i)
    const b = document.createElement('button')
    b.className = 'bolum'
    b.disabled = !open
    b.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span>
      <span class="ad"></span>
      <span class="rekor">${best ? 'Rekor ' + fmt(best.time) : open ? 'Henüz süre yok' : 'Önceki bölümden bronz al'}</span>
      <span class="madalyalar" aria-label="${['Madalya yok', 'Bronz', 'Gümüş', 'Altın'][medal]}">
        <i class="m b ${medal >= 1 ? 'on' : ''}"></i><i class="m s ${medal >= 2 ? 'on' : ''}"></i><i class="m g ${medal >= 3 ? 'on' : ''}"></i>
      </span>`
    b.querySelector('.ad')!.textContent = def.name
    b.onclick = () => startSolo(i)
    b.onmouseenter = () => open && setPreview(def)
    b.onfocus = () => open && setPreview(def)
    list.append(b)
  })
  $('madalya-toplam').textContent = `${gold}/${LEVELS.length} altın`
}

// ------------------------------------------------------------------ yarış kurulumu
function loadRun(def: TrackDef, level: number, withGhost: boolean) {
  disposeRun()
  const track = previewTrack?.def === def ? previewTrack : new Track(def)
  previewTrack = track
  world.setTrack(track)
  const race = new Race(track)
  const player = makeCar(getColor())
  world.scene.add(player.group)
  const best = loadBest(def.id)
  let ghost: CarView | undefined
  let ghostData: Float32Array | undefined
  if (withGhost && best?.ghost) {
    ghostData = unpackGhost(best.ghost)
    ghost = makeCar(0xd8f3ff, { ghost: true })
    world.scene.add(ghost.group)
  }
  run = { def, track, race, player, ghost, ghostData, best, level }
  race.onCheckpoint = (e) => onCheckpoint(e.index, e.time)
  race.onFinish = (t) => onFinish(t)
  race.onRespawn = () => {
    world.shake = 0
  }
}

function disposeRun() {
  if (!run) return
  world.scene.remove(run.player.group)
  run.player.dispose()
  if (run.ghost) {
    world.scene.remove(run.ghost.group)
    run.ghost.dispose()
  }
  run = null
}

function beginCountdown(ms: number) {
  if (!run) return
  run.race.restart()
  controls.reset()
  acc = 0
  countdownEnd = performance.now() + ms
  lastCount = -1
  paused = false
  overlay(null)
  for (const s of screens) $(s).classList.add('gizli')
  $('hud').classList.remove('gizli')
  $('hud-fark').className = 'hud-fark'
  run.race.car.quaternion(curQ)
  prevP.copy(run.race.car.p)
  prevQ.copy(curQ)
  updateHudStatic()
}

function startSolo(level: number) {
  mode = 'solo'
  loadRun(LEVELS[level], level, true)
  beginCountdown(1200)
}

function startTest(def: TrackDef) {
  mode = 'test'
  loadRun(def, -1, true)
  beginCountdown(1200)
}

function updateHudStatic() {
  if (!run) return
  $('hud-pist').textContent = (run.level >= 0 ? `${run.level + 1}. ` : '') + run.def.name
  $('hud-cp').textContent = `Kontrol 0/${run.track.cps.length}`
  const m = MEDALS[run.def.id]
  const best = run.best
  const parts: string[] = []
  if (best) parts.push('Rekor ' + fmt(best.time))
  if (m && mode === 'solo') {
    const med = medalFor(run.def.id, best?.time)
    if (med < 3) parts.push(['Bronz', 'Gümüş', 'Altın'][med] + ' ' + fmt(m[2 - med]))
  }
  $('hud-hedef').textContent = parts.join(' · ')
  $('hud-siralama').innerHTML = ''
}

function quitToMenu() {
  disposeRun()
  overlay(null)
  $('hud').classList.add('gizli')
  if (lobby) leaveLobby()
  mode = 'menu'
  show('menu')
}

// ------------------------------------------------------------------ olaylar
let fadeTimer = 0
function showDelta(ms: number | null, label = '') {
  const el = $('hud-fark')
  if (ms == null) {
    el.textContent = label
    el.className = 'hud-fark goster'
  } else {
    el.textContent = fmt(ms, true)
    el.className = 'hud-fark goster ' + (ms <= 0 ? 'iyi' : 'kotu')
  }
  clearTimeout(fadeTimer)
  fadeTimer = window.setTimeout(() => el.classList.remove('goster'), 2200)
}

function onCheckpoint(i: number, t: number) {
  if (!run) return
  sfx.checkpoint()
  $('hud-cp').textContent = `Kontrol ${i + 1}/${run.track.cps.length}`
  const ref = run.best?.cps?.[i]
  showDelta(ref != null ? t - ref : null, ref == null ? `Kontrol ${i + 1}` : '')
}

function onFinish(t: number) {
  if (!run) return
  sfx.finish()
  if (mode === 'multi') {
    lobby?.finish(t)
    showDelta(null, 'Bitti! ' + fmt(t))
    return
  }
  const def = run.def
  const prev = run.best?.time
  const rec = saveIfBest(def.id, t, run.race.ghost, run.race.cpTimes)
  const medal = medalFor(def.id, Math.min(t, prev ?? Infinity))
  const thisMedal = medalFor(def.id, t)
  $('bitis-sure').textContent = fmt(t)
  const names = ['', 'Bronz', 'Gümüş', 'Altın']
  const colors = ['', '#d58a4d', '#d7dbe6', '#ffcf3f']
  const mEl = $('bitis-madalya')
  mEl.textContent = thisMedal ? names[thisMedal] + ' madalya' : MEDALS[def.id] ? 'Madalya yok' : 'Bitti'
  mEl.style.color = thisMedal ? colors[thisMedal] : ''
  $('bitis-not').textContent = rec
    ? prev != null
      ? `Yeni rekor! Öncekinden ${fmt(t - prev, true)}`
      : 'İlk süren kaydedildi. Hayaletin artık seninle yarışacak.'
    : `Rekorun ${fmt(prev!)} (${fmt(t - prev!, true)})`
  const m = MEDALS[def.id]
  const hed = $('bitis-hedefler')
  hed.innerHTML = ''
  if (m) {
    ;[2, 1, 0].forEach((k, j) => {
      const d = document.createElement('div')
      if (medal >= j + 1) d.classList.add('tamam')
      d.innerHTML = `<i class="m ${['b', 's', 'g'][j]} on"></i><span>${fmt(m[k])}</span>`
      hed.append(d)
    })
  }
  const next = run.level + 1
  const nextBtn = $<HTMLButtonElement>('bitis-sonraki')
  nextBtn.classList.toggle('gizli', mode !== 'solo' || next >= LEVELS.length)
  nextBtn.disabled = !(next < LEVELS.length && isUnlocked(next))
  nextBtn.textContent = nextBtn.disabled ? 'Sonraki bölüm (bronz gerekli)' : 'Sonraki bölüm'
  $('bitis-bolumler').textContent = mode === 'test' ? 'Atölyeye dön' : 'Bölümler'
  // hayaleti yeni rekorla güncelle
  if (rec) run.best = loadBest(def.id)
  setTimeout(() => overlay('bitis'), 650)
}

$('bitis-tekrar').onclick = () => restartRun()
$('bitis-sonraki').onclick = () => run && startSolo(run.level + 1)
$('bitis-bolumler').onclick = () => {
  const toEditor = mode === 'test'
  disposeRun()
  overlay(null)
  $('hud').classList.add('gizli')
  mode = 'menu'
  show(toEditor ? 'atolye' : 'bolumler')
}
$('devam').onclick = () => togglePause(false)
$('dur-yeniden').onclick = () => {
  togglePause(false)
  restartRun()
}
$('dur-menu').onclick = () => quitToMenu()

function restartRun() {
  if (!run) return
  if (mode === 'multi') {
    // lobide süre ortaktır: başa dön ama saat durmaz
    if (run.race.started && !run.race.finished) {
      run.race.toStart()
      controls.reset()
    }
    return
  }
  const level = run.level
  const def = run.def
  const withGhost = true
  // hayalet yeni rekorla değiştiyse yeniden yükle
  loadRun(def, level, withGhost)
  beginCountdown(900)
}

function togglePause(v = !paused) {
  if (!run) return
  if (mode === 'multi') {
    // çok oyunculuda zaman durmaz; yalnızca menü açılır
    paused = false
    $('duraklat').classList.toggle('gizli', !v)
    $('dur-yeniden').classList.add('gizli')
    $('dur-menu').textContent = 'Lobiden çık'
    return
  }
  paused = v
  $('dur-yeniden').classList.remove('gizli')
  $('dur-menu').textContent = 'Menüye dön'
  overlay(paused ? 'duraklat' : null)
}

controls.onAction = (a) => {
  if (!run || mode === 'menu') return
  if (a === 'restart') {
    if (!$('bitis').classList.contains('gizli') || !paused) restartRun()
  } else if (a === 'respawn') {
    if (!paused && run.race.started) run.race.respawn()
  } else if (a === 'pause') {
    if (!$('bitis').classList.contains('gizli')) return
    togglePause()
  }
}

// ------------------------------------------------------------------ ana döngü
let last = performance.now()
let netTimer = 0
let fpsAcc = 0,
  fpsN = 0,
  fps = 60
function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  fpsAcc += dt
  fpsN++
  if (fpsAcc > 1) {
    fps = Math.round(fpsN / fpsAcc)
    fpsAcc = 0
    fpsN = 0
  }

  if (!run) {
    world.orbit(now / 1000)
    sfx.engine(0, 0, false)
    world.render()
    return
  }
  const race = run.race
  const car = race.car

  // geri sayım
  if (countdownEnd) {
    const left = countdownEnd - now
    const el = $('geri-sayim')
    if (left > 0) {
      const n = Math.ceil(left / (mode === 'multi' ? 1000 : 400))
      if (n !== lastCount) {
        lastCount = n
        el.textContent = String(Math.min(3, n))
        el.classList.remove('vur')
        void el.offsetWidth
        el.classList.add('vur')
        sfx.beep(520, 0.1)
      }
    } else {
      countdownEnd = 0
      race.started = true
      el.textContent = 'GİT'
      el.classList.remove('vur')
      void el.offsetWidth
      el.classList.add('vur')
      sfx.beep(1040, 0.25)
      setTimeout(() => {
        if (!countdownEnd) el.textContent = ''
      }, 500)
    }
  }

  if (!paused) {
    acc += dt
    while (acc >= DT) {
      lastInput = pilot && race.started && !race.finished ? botInput(race) : controls.read(DT)
      prevP.copy(car.p)
      car.quaternion(prevQ)
      race.step(lastInput)
      acc -= DT
      if (car.landed > 14) world.shake = Math.min(0.5, car.landed * 0.02)
    }
  }
  const alpha = paused ? 1 : acc / DT
  car.quaternion(curQ)
  // yeniden doğmada enterpolasyon atlaması olmasın
  if (prevP.distanceToSquared(car.p) > 100) prevP.copy(car.p)
  drawP.copy(prevP).lerp(car.p, alpha)
  drawQ.copy(prevQ).slerp(curQ, alpha)
  run.player.setPose(drawP, drawQ)
  run.player.animate(car.fwdSpeed, lastInput.steer, dt)

  // hayalet
  if (run.ghost && run.ghostData) {
    const vis = sampleGhost(run.ghostData, race.time, tmpV, tmpQ)
    run.ghost.group.visible = race.started || countdownEnd > 0
    run.ghost.setPose(tmpV, tmpQ)
    run.ghost.animate(vis ? 50 : 0, 0, dt)
  }

  // uzak oyuncular
  if (mode === 'multi') updateRemotes(now, dt)

  world.follow(drawP, car.f, car.up, car.v, car.grounded, dt)
  sfx.engine(car.speed, lastInput.throttle, race.started && !paused)

  // HUD
  $('hud-sure').textContent = fmt(race.time)
  $('hud-hiz').firstElementChild!.textContent = String(Math.round(Math.abs(car.fwdSpeed) * 3.6))

  if (mode === 'multi' && lobby && race.started) {
    netTimer += dt
    if (netTimer > 0.05) {
      netTimer = 0
      lobby.pos([
        r2(drawP.x),
        r2(drawP.y),
        r2(drawP.z),
        r3(drawQ.x),
        r3(drawQ.y),
        r3(drawQ.z),
        r3(drawQ.w),
        r2(lastInput.steer),
        r2(car.fwdSpeed),
        race.finished ? 1e6 : car.idx + race.nextCp * 1e4,
        race.nextCp,
      ])
      updateLiveRanking()
    }
  }
  world.render()
}
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
requestAnimationFrame(frame)

// ------------------------------------------------------------------ lobi
let lobby: Lobby | null = null
let joinTimer = 0
let lastPhase = ''
const remotes = new Map<string, { view: CarView; buf: { t: number; p: PosPacket }[]; color: string; name: string }>()

const trackSelect = $<HTMLSelectElement>('pist-sec')
LEVELS.forEach((d, i) => trackSelect.add(new Option(`${i + 1}. ${d.name}`, d.id)))
trackSelect.onchange = () => lobby?.setTrack(trackSelect.value)
$('ozel-pist-yukle').onclick = () => {
  const code = $<HTMLInputElement>('ozel-pist-kodu').value.trim()
  const def = decodeTrack(code)
  if (!def) return toast('Pist kodu okunamadı')
  if (!trackSelect.querySelector('option[value="ozel"]')) trackSelect.add(new Option('Özel: ' + def.name, 'ozel'))
  trackSelect.value = 'ozel'
  lobby?.setTrack('ozel', code)
}

function defFor(state: LobbyState): TrackDef {
  if (state.trackId === 'ozel' && state.trackCode) {
    const d = decodeTrack(state.trackCode)
    if (d) return d
  }
  return LEVELS.find((l) => l.id === state.trackId) ?? LEVELS[0]
}

function openLobby(code: string, host: boolean) {
  leaveLobby()
  $('lobi-hata').textContent = ''
  const me = { name: myName(), color: getColor() }
  try {
    lobby = new Lobby(code, host, me, LEVELS[0].id)
  } catch (e) {
    $('lobi-hata').textContent = 'Bağlantı kurulamadı: ' + (e as Error).message
    return
  }
  history.replaceState(null, '', '?oda=' + code)
  $('lobi-giris').classList.add('gizli')
  $('lobi-oda').classList.remove('gizli')
  $('oda-kod-goster').textContent = code
  lastPhase = 'lobby'
  lobby.onState = (s) => onLobbyState(s)
  lobby.onPos = (id, p) => {
    let r = remotes.get(id)
    const pl = lobby?.state.players.find((x) => x.id === id)
    if (!r) {
      const color = pl?.color ?? '#ffffff'
      const view = makeCar(color, { opacity: 0.6, name: pl?.name ?? '?' })
      world.scene.add(view.group)
      r = { view, buf: [], color, name: pl?.name ?? '?' }
      remotes.set(id, r)
    }
    r.buf.push({ t: performance.now(), p })
    if (r.buf.length > 20) r.buf.shift()
  }
  lobby.onLeave = (id) => {
    const r = remotes.get(id)
    if (r) {
      world.scene.remove(r.view.group)
      r.view.dispose()
      remotes.delete(id)
    }
    toast('Bir oyuncu ayrıldı')
  }
  lobby.onPeerCount = () => renderLobby()
  lobby.onGo = (delay, raceId) => startMulti(delay, raceId)
  if (!host) {
    $('oda-durum').textContent = 'Oda sahibine bağlanılıyor… (P2P bağlantısı birkaç saniye sürebilir)'
    joinTimer = window.setTimeout(() => {
      if (lobby && !lobby.state.hostId) $('oda-durum').textContent = 'Henüz kimse bulunamadı. Kodu kontrol et ya da oda sahibinin sayfası açık mı bak. Beklemeye devam ediliyor…'
    }, 15000)
  }
  renderLobby()
}

function leaveLobby() {
  clearTimeout(joinTimer)
  if (lobby) lobby.leave()
  lobby = null
  for (const r of remotes.values()) {
    world.scene.remove(r.view.group)
    r.view.dispose()
  }
  remotes.clear()
  $('lobi-giris').classList.remove('gizli')
  $('lobi-oda').classList.add('gizli')
  if (location.search) history.replaceState(null, '', location.pathname)
}

function renderLobby() {
  if (!lobby) return
  const s = lobby.state
  const ul = $('oyuncular')
  ul.innerHTML = ''
  for (const p of s.players) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="nokta" style="background:${p.color}"></span><span class="ad"></span>`
    li.querySelector('.ad')!.textContent = p.name + (p.id === lobby.selfId ? ' (sen)' : '')
    if (p.id === s.hostId) li.insertAdjacentHTML('beforeend', '<span class="rozet">oda sahibi</span>')
    ul.append(li)
  }
  const host = lobby.isHost
  $('sahip-araclari').classList.toggle('gizli', !host)
  $('misafir-notu').classList.toggle('gizli', host)
  if (s.hostId) {
    const def = defFor(s)
    $('oda-durum').textContent = `${s.players.length} oyuncu · Pist: ${def.name}` + (host && lobby.peerCount === 0 ? ' · Arkadaşlarını bekliyorsun' : '')
  }
  if (host) trackSelect.value = s.trackId
}

function onLobbyState(s: LobbyState) {
  renderLobby()
  // önizlemeyi lobideki piste çevir
  const def = defFor(s)
  if (!run && previewTrack?.def.id !== def.id) {
    previewTrack = new Track(def)
    world.setTrack(previewTrack)
  }
  for (const p of s.players) {
    const r = remotes.get(p.id)
    if (r && r.name !== p.name) r.name = p.name
  }
  if (s.phase === 'results' && lastPhase !== 'results') showResults(s)
  else if (s.phase === 'results') showResults(s)
  if (s.phase === 'lobby' && lastPhase !== 'lobby') {
    // yarış bitti, lobiye dön
    disposeRun()
    overlay(null)
    $('hud').classList.add('gizli')
    mode = 'menu'
    show('lobi')
  }
  lastPhase = s.phase
}

function startMulti(delay: number, _raceId: number) {
  if (!lobby) return
  mode = 'multi'
  const def = defFor(lobby.state)
  loadRun(def, -1, false)
  for (const r of remotes.values()) r.buf = []
  beginCountdown(delay)
}

function updateRemotes(now: number, dt: number) {
  const renderT = now - 110
  for (const r of remotes.values()) {
    const b = r.buf
    if (!b.length) {
      r.view.group.visible = false
      continue
    }
    r.view.group.visible = true
    let i = b.length - 1
    while (i > 0 && b[i - 1].t > renderT) i--
    const a = b[Math.max(0, i - 1)],
      c = b[i]
    const f = c.t === a.t ? 1 : Math.max(0, Math.min(1, (renderT - a.t) / (c.t - a.t)))
    tmpV.set(a.p[0], a.p[1], a.p[2]).lerp(rv.set(c.p[0], c.p[1], c.p[2]), f)
    tmpQ.set(a.p[3], a.p[4], a.p[5], a.p[6]).slerp(rq.set(c.p[3], c.p[4], c.p[5], c.p[6]), f)
    r.view.setPose(tmpV, tmpQ)
    r.view.animate(c.p[8], c.p[7], dt)
  }
}
const rv = new THREE.Vector3()
const rq = new THREE.Quaternion()

function updateLiveRanking() {
  if (!lobby || !run) return
  const me = lobby.selfId
  const rows = lobby.state.players.map((p) => {
    let prog = p.progress + p.cp * 0
    if (p.id === me) prog = run!.race.finished ? 1e6 : run!.race.car.idx + run!.race.nextCp * 1e4
    else {
      const r = remotes.get(p.id)
      const lastP = r?.buf[r.buf.length - 1]?.p
      if (lastP) prog = lastP[9]
    }
    return { p, prog: p.time != null ? 2e6 - p.time : prog }
  })
  rows.sort((a, b) => b.prog - a.prog)
  const ol = $('hud-siralama')
  ol.innerHTML = ''
  rows.forEach((r, i) => {
    const li = document.createElement('li')
    if (r.p.id === me) li.className = 'ben'
    li.innerHTML = `<b>${i + 1}</b><span class="nokta" style="background:${r.p.color}"></span><span></span>`
    li.lastElementChild!.textContent = r.p.name + (r.p.time != null ? ' · ' + fmt(r.p.time) : '')
    ol.append(li)
  })
}

function showResults(s: LobbyState) {
  const ol = $('sonuc-listesi')
  ol.innerHTML = ''
  const sorted = [...s.players].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
  for (const p of sorted) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="nokta" style="background:${p.color}"></span><span class="ad"></span><span class="sure">${p.time != null ? fmt(p.time) : 'bitirmedi'}</span>`
    li.querySelector('.ad')!.textContent = p.name + (p.id === lobby?.selfId ? ' (sen)' : '')
    ol.append(li)
  }
  $('sonuc-baslik').textContent = 'Sıralama · ' + defFor(s).name
  const host = !!lobby?.isHost
  $('sonuc-sahip').classList.toggle('gizli', !host)
  $('sonuc-misafir').classList.toggle('gizli', host)
  overlay('sonuc')
}

$('oda-ac').onclick = () => {
  sfx.unlock()
  openLobby(makeCode(), true)
}
$('oda-katil').onclick = () => {
  const code = $<HTMLInputElement>('oda-kodu').value.trim().toUpperCase()
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    $('lobi-hata').textContent = 'Oda kodu 5 karakter olmalı'
    return
  }
  openLobby(code, false)
}
$('baglanti-kopyala').onclick = async () => {
  if (!lobby) return
  const url = location.origin + location.pathname + '?oda=' + lobby.code
  try {
    await navigator.clipboard.writeText(url)
    toast('Bağlantı kopyalandı')
  } catch {
    toast(url)
  }
}
$('yaris-baslat').onclick = () => {
  if (!lobby) return
  if (lobby.state.players.length < 2) toast('Tek başına başlıyorsun; arkadaşların sonraki yarışa katılabilir')
  lobby.startRace()
}
$('sonuc-tekrar').onclick = () => lobby?.startRace()
$('sonuc-lobi').onclick = () => lobby?.backToLobby()
$('lobi-geri').onclick = () => {
  leaveLobby()
  show('menu')
}

// bağlantıyla gelindiyse odaya otomatik katıl
const urlCode = new URLSearchParams(location.search).get('oda')
if (urlCode && /^[A-Z0-9]{5}$/i.test(urlCode)) {
  show('lobi')
  $<HTMLInputElement>('oda-kodu').value = urlCode.toUpperCase()
  openLobby(urlCode.toUpperCase(), false)
} else {
  show('menu')
}

// ------------------------------------------------------------------ atölye
const editor = new Editor({
  onPreview: (def) => {
    if (run) return
    previewTrack = new Track(def)
    world.setTrack(previewTrack)
  },
  onDrive: (def) => startTest(def),
  toast,
})

// test ve hata ayıklama için (konsoldan)
;(window as unknown as Record<string, unknown>).__oyun = {
  get run() {
    return run
  },
  get lobby() {
    return lobby
  },
  get fps() {
    return fps
  },
  pilot: (v: boolean) => (pilot = v),
  startSolo,
  hepsiniAc: () => {
    localStorage.setItem('rr.hepsiAcik', '1')
    renderLevels()
  },
}
