// Pistin kendi kendini kesip kesmediğini denetler: yatayda yakın, indeksçe uzak örnekler arasındaki dikey açıklık
import { LEVELS } from '../src/sim/tracks'
import { Track } from '../src/sim/track'
let bad = 0
for (const def of LEVELS) {
  const tr = new Track(def)
  let worst = Infinity, at = [0, 0]
  for (let i = 0; i < tr.count; i += 2)
    for (let j = i + 60; j < tr.count; j += 2) {
      if (!tr.surface[i] || !tr.surface[j]) continue
      const a = tr.P[i], b = tr.P[j]
      const dxz = Math.hypot(a.x - b.x, a.z - b.z)
      if (dxz > (tr.W[i] + tr.W[j]) / 2 + 2) continue
      const dy = Math.abs(a.y - b.y)
      // döngü kendi içinde sayılmaz
      if (tr.U[i].y < 0.7 || tr.U[j].y < 0.7) continue
      if (dy < worst) { worst = dy; at = [i, j] }
    }
  const ok = worst > 9
  if (!ok) bad++
  console.log(def.id, def.name.padEnd(16), worst === Infinity ? 'kesişme yok' : `en yakın dikey açıklık ${worst.toFixed(1)} m @${at}`, ok ? '' : '<-- SORUN')
}
process.exit(bad ? 1 : 0)
