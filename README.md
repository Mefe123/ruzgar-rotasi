# Rüzgâr Rotası

Tarayıcıda oynanan, low-poly bir zamana karşı yarış oyunu. Üç temada (kanyon, buzul, gece) 15 el yapımı bölüm, madalya hedefleri, kendi en iyi turunun hayaleti, arkadaşlarla P2P lobi ve basit bir pist atölyesi içerir. Ücretli araç ya da sunucu yok.

Teknoloji: Vite + TypeScript + Three.js, P2P için Trystero (Nostr sinyali), araç fiziği kendi modelimiz (`src/sim/`).

## Fizik

Araç dört tekerlekli bir katı gövde: her tekerlek pist yüzeyine yerel normal boyunca ışın atar; yay, amortisör, denge çubuğu ve kayma açısına bağlı lastik kuvveti (sürtünme çemberiyle) hesaplanır. Hızla artan yere basma kuvveti yüksek hızda tutuşu artırır. Döngü, duvar sürüşü, sıçrama ve sert inişler ayrı kural olmadan gövde dinamiğinden çıkar. Fizik 120 Hz dış adım, 3 alt adımla (360 Hz) çalışır ve belirlenimcidir: aynı girişle aynı süre çıkar (hayalet ve lobi buna dayanır).

- **Yüzeyler:** asfalt, buz (tutuş %42) ve toprak (%72).
- **Drift:** Boşluk arka tekerleklerin tutuşunu düşürür; karşı direksiyonla kontrol edilir.
- **Havada:** direksiyon sapma, gaz/fren burun yukarı/aşağı verir.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tip denetimi + dist/ klasörüne statik çıktı
npm test           # pistlerde kendi üstünden geçme denetimi + otomatik pilot 15 bölümü sürer; sorun varsa hata verir
```

Madalya sürelerini yeniden ölçmek için (pist değiştirdiysen): `npx tsx scripts/kalibre.ts --yaz` → `src/sim/medals.ts` güncellenir.

## Kontroller

| | Klavye | Dokunmatik |
|---|---|---|
| Gaz / fren-geri | W / S ya da ↑ / ↓ | ▲ / ◼ |
| Direksiyon | A / D ya da ← / → | ◀ ▶ |
| Drift | Boşluk (ya da Sol Shift) | DRIFT |
| Yeniden başla | R | ↺ |
| Son kontrol noktası | Enter / Backspace / C | ⚑ |
| Duraklat | Esc / P | ❚❚ |

## Oyun

- **Bölümler:** zorluk sırayla artar (viraj → hız şeridi → tepeler → sıçrama → duvar sürüşü → döngü → kenarsız dar geçit → keskin virajlar → buz, toprak, sarmal ve uzun karma pistler). Bir bölümde bronz alınca sonraki açılır.
- **Süre:** milisaniye hassas; fizik saniyede 120 sabit adımla çalışır, bitiş çizgisi geçişi adım içinde enterpole edilir. Aynı girişle aynı süre çıkar.
- **Rekor ve hayalet:** her bölümün en iyi süresi, kontrol noktası ara süreleri ve hayalet kaydı `localStorage`'da tutulur. Kontrol noktasında rekora göre fark gösterilir.
- **Lobi:** "Oda aç" 5 karakterlik kod üretir; bağlantı (`?oda=KOD`) paylaşılabilir. Oda sahibi pisti seçer (bölümlerden biri ya da atölyeden pist kodu) ve yarışı başlatır; geri sayım herkes için aynı anda başlar. Araçlar birbirinin içinden geçer (çarpışma yok), sol üstte canlı sıralama, sonunda sıralama ekranı çıkar. Lobide R başa döndürür ama ortak saat durmaz.
- **Pist atölyesi:** hazır parçaları sırayla ekle, sür, "Kodu kopyala" ile paylaş. Kod lobide de kullanılabilir.
- **Ayarlar:** ses, "Hareketi azalt" (işletim sistemindeki `prefers-reduced-motion` ayarını varsayılan alır; kamera sarsıntısı, hıza bağlı görüş açısı değişimi ve arayüz animasyonları kapanır).

## Yayına alma (statik barındırma)

`npm run build` sonrası `dist/` klasörü tek başına çalışır (`base: './'`), her statik barındırmaya konabilir:

- **GitHub Pages:** `dist/` içeriğini `gh-pages` dalına koy ya da GitHub Actions ile Pages'e yükle. Alt klasörde (`kullanici.github.io/depo/`) de çalışır.
- **Cloudflare Pages / Netlify:** derleme komutu `npm run build`, çıktı klasörü `dist`.

Lobi bağlantıları sayfanın kendi adresini kullandığından ek ayar gerekmez. HTTPS gerekir (WebRTC ve pano için); bu barındırmaların hepsi zaten HTTPS verir.

## P2P'nin sınırları

- **Sunucu yok, sinyal var:** oyuncular birbirini herkese açık Nostr röleleri üzerinden bulur, sonra doğrudan WebRTC ile konuşur. Röleler ücretsiz ve gönüllü işletilir; nadiren hepsi erişilemezse odaya katılınamaz.
- **TURN sunucusu yok:** bazı kurumsal ağlar, mobil operatörler ya da simetrik NAT arkasındaki cihazlar doğrudan bağlanamayabilir. Böyle bir durumda TURN gerekir (ücretsiz katman sunan bir sağlayıcı `src/game/net.ts` içindeki `joinRoom` ayarına `rtcConfig` olarak eklenebilir).
- **Oda sahibi yetkilidir:** lobinin durumunu ve sonuçları oda sahibi tutar. Süreleri her oyuncu kendi tarayıcısında ölçüp bildirir; hile koruması yoktur (arkadaş oyunu için tasarlandı).
- **Oda sahibi ayrılırsa** kalanlar arasından biri otomatik devralır, süren yarış sonuçlanır.
- **Ölçek:** her oyuncu herkesle bağlantı kurar (tam ağ). 2–8 kişi rahattır; daha kalabalık odalar önerilmez.
- **Gizlilik:** oda kodu bilen herkes katılabilir. Paylaşılan tek bilgi takma ad, araç rengi ve araç konumudur.

## Klasör yapısı

```
src/sim/      fizik, pist üretimi, yarış kuralları, bölümler (tarayıcıdan bağımsız; Node'da test edilir)
src/game/     çizim (Three.js), araç modeli, giriş, ses, kayıt, lobi, atölye
scripts/      kalibre.ts: otomatik pilotla bitirme testi ve madalya süreleri
ekran-goruntuleri/  masaüstü ve mobil doğrulama görüntüleri
```

Hata ayıklama: sayfa adresine `?pilot` eklenirse yarışlarda otomatik pilot sürer; konsolda `__oyun` nesnesi vardır (`__oyun.hepsiniAc()` bütün bölümleri açar).

## Özgünlük

Ad, araç tasarımı, renk paleti, temalar ve bütün pistler bu proje için yapıldı. Tür olarak bilinen zamana karşı yarış oyunlarına benzer; başka bir oyunun adı, logosu, pisti ya da görünüşü kullanılmadı. Yazı tipi: Unbounded (SIL Open Font License, `@fontsource/unbounded`).
