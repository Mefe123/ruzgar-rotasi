// Her bölümü otomatik pilotla sürer: bitirilebildiğini doğrular ve madalya sürelerini önerir.
// Çalıştır: npm test
import { LEVELS } from '../src/sim/tracks'
import { Track } from '../src/sim/track'
import { Race, botInput } from '../src/sim/race'
import { writeFileSync } from 'node:fs'

const medals: Record<string, [number, number, number]> = {}

let fail = 0
for (const def of LEVELS) {
  const tr = new Track(def)
  const race = new Race(tr)
  race.started = true
  let respawns = 0
  const falls: number[] = []
  race.onRespawn = () => { respawns++; falls.push(lastIdx) }
  let lastIdx = 0
  const maxSteps = 120 * 240
  let maxSpeed = 0
  let air = 0
  for (let s = 0; s < maxSteps && !race.finished; s++) {
    lastIdx = race.car.idx
    race.step(botInput(race))
    maxSpeed = Math.max(maxSpeed, race.car.speed)
    if (!race.car.grounded) air++
    if (respawns > 6) break
  }
  const ok = race.finished
  if (!ok) fail++
  const t = race.finishTime
  const gold = Math.round((t * 1.0) / 100) * 100
  const silver = Math.round((t * 1.12) / 100) * 100
  const bronze = Math.round((t * 1.35) / 100) * 100
  if (ok) medals[def.id] = [gold, silver, bronze]
  console.log(
    `${def.id} ${def.name.padEnd(16)} ${ok ? 'BİTTİ' : 'BİTMEDİ'} süre=${(t / 1000).toFixed(3)}s ` +
      `uzunluk=${tr.count}m cp=${race.cpTimes.length}/${tr.cps.length} idx=${race.car.idx} ` +
      `yeniden=${respawns} hava=${(air / 120).toFixed(1)}s vmax=${(maxSpeed * 3.6).toFixed(0)}km/s ` +
      `öneri=[${gold}, ${silver}, ${bronze}] düşüş@${falls.join(',')}`,
  )
}
if (process.argv.includes('--yaz')) {
  writeFileSync(
    new URL('../src/sim/medals.ts', import.meta.url),
    '// scripts/kalibre.ts --yaz ile üretildi: altın, gümüş, bronz (ms)\n' +
      'export const MEDALS: Record<string, [number, number, number]> = ' +
      JSON.stringify(medals, null, 2) +
      '\n',
  )
  console.log('src/sim/medals.ts yazıldı')
}
process.exit(fail ? 1 : 0)
