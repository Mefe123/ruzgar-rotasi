import { LEVELS } from '../src/sim/tracks'
import { Track } from '../src/sim/track'
import { Race, botInput } from '../src/sim/race'
const id = process.argv[2] || 'b01', from = +(process.argv[3] || 0), to = +(process.argv[4] || 9999)
const tr = new Track(LEVELS.find(l => l.id === id)!); const r = new Race(tr); r.started = true
for (let s = 0; s < 120 * 40 && !r.finished; s++) {
  const inp = botInput(r); r.step(inp); const c = r.car
  if (c.idx >= from && c.idx <= to && s % 10 === 0) {
    const P = tr.P[c.idx]; const d = c.p.clone().sub(P).dot(tr.R[c.idx]); const h = c.p.clone().sub(P).dot(tr.U[c.idx])
    console.log(s, 'idx', c.idx, 'v', (c.speed*3.6).toFixed(0), 'd', d.toFixed(2), 'h', h.toFixed(2), 'up.y', c.up.y.toFixed(2), 'g', c.grounded, 'wc', c.wheelContact.map(x=>x?1:0).join(''), 'steer', inp.steer.toFixed(2), 'thr', inp.throttle, 'slip', c.slip.toFixed(1), 'scr', c.scrape.toFixed(1))
  }
  if (c.idx > to) break
}
