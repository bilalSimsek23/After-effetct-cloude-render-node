# Render Node Kurulumu

Bu doküman, yeni bir makineyi (Mac veya Windows) MotionCurate Cloud Render için render node olarak hazırlamanın tam adımlarını anlatır.

## 1. Otomatik kurulum script'ini çalıştır

Proje klasörünü hedef makineye kopyala, sonra:

**macOS:**
```bash
bash scripts/setup-mac.sh
```

**Windows (PowerShell, yönetici olarak):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

Bu script:
- Node.js 22+ ve `cloudflared`'i kontrol eder, eksikse kurar (Mac: Homebrew, Windows: winget)
- `npm install` + `npm run build` çalıştırır
- `config.json`'ı interaktif olarak doldurur (aşağıdaki 2. ve 3. adımlardaki bilgileri isteyecek)

Script sana `nodeUuid`, `apiSecret` ve `tunnelToken` soracak — bunları henüz almadıysan boş geçip aşağıdaki adımları tamamladıktan sonra script'i tekrar çalıştırabilir ya da `config.json`'ı elle düzenleyebilirsin.

## 2. Cloudflare Tunnel oluştur (bir kere, panelden)

Render node'lar NAT arkasında/ev-ofis ağlarında çalışabildiği için, Laravel'in bu node'a ulaşabilmesi bir Cloudflare Tunnel üzerinden sağlanıyor — port yönlendirme veya sabit IP gerekmiyor.

1. https://one.dash.cloudflare.com adresine git.
2. **Networks > Tunnels > Create a tunnel**.
3. Connector tipi: **Cloudflared**. Tünele bir isim ver (örn. `render-node-1`).
4. Kurulum ekranında gösterilen komuttaki token'ı (`eyJ...` ile başlayan uzun metin) kopyala — bu, `config.json`'daki `pushServer.tunnelToken` alanı.
5. **Public Hostname** sekmesinde:
   - Subdomain: örn. `render-node-1`
   - Domain: `motioncurate.com`
   - Type: `HTTP`
   - URL: `localhost:4790` (veya `config.json`'da seçtiğin `pushServer.port`)
6. Kaydet.

Bu node'un `callback_url`'i artık `https://render-node-1.motioncurate.com/render-jobs/notify` olacak (yol kısmı sabit — `render-jobs/notify`).

## 3. Node'u Laravel'e kaydet

Production'da (admin/SSH erişimi olan biri) şunu çalıştırır:

```bash
php artisan cloud-render:register-render-node \
  --callback-url=https://render-node-1.motioncurate.com/render-jobs/notify \
  --name="Node'un adı" \
  --max-concurrent-jobs=1
```

Komut bir `uuid` ve bir `api_secret` döndürür — **bu ikisi sadece bir kez gösterilir**, kaybedersen aynı `--uuid=<uuid>` ile komutu tekrar çalıştırıp (rotate ederek) yeni bir secret alman gerekir. Bu iki değeri `config.json`'daki `nodeUuid`/`apiSecret` alanlarına gir.

## 4. Node'u başlat

```bash
npm start
```

Terminalde şunları görmelisin: Adobe Runtime hazır → capability toplandı → Cloudflare Tunnel bağlandı → push server dinlemede → "Render Node çalışıyor".

## Sorun Giderme

- **`cloudflared` "başlatılamadı" hatası:** PATH üzerinde olduğundan emin ol (`cloudflared --version` çalışmalı).
- **Push bildirimi hiç gelmiyor:** Cloudflare panelinde tünelin "Healthy" göründüğünü, Public Hostname'in doğru porta işaret ettiğini kontrol et.
- **401 RENDER_NODE_UNAUTHORIZED:** `config.json`'daki `nodeUuid`/`apiSecret` production'daki kayıtla eşleşmiyor olabilir — `cloud-render:register-render-node --uuid=<uuid>` ile secret'ı rotate edip güncelle.
- **After Effects bulunamadı:** Render node çalışabilir ama gerçek render işi başarısız olur — hedef makinede After Effects kurulu ve lisanslı olmalı.
