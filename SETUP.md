# Render Node Kurulumu

Bu doküman, yeni bir makineyi (Mac veya Windows) MotionCurate Cloud Render için render node olarak hazırlamanın tam adımlarını anlatır.

## 1. Otomatik kurulum script'ini çalıştır

Proje klasörünü **git clone ile** hedef makineye getir (dosyaları elle kopyalama — repo public, otomatik güncelleme (bkz. adım 1b) bu klasörün gerçek bir git deposu olmasını gerektiriyor):

```bash
git clone https://github.com/bilalSimsek23/After-effetct-cloude-render-node.git pratiktools-render-node
cd pratiktools-render-node
```

Sonra:

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

## 1b. Otomatik güncelleme (fleet-wide auto-update)

Kurulum sırasında script "Otomatik güncelleme aktif olsun mu?" diye soracak. Evet dersen (varsayılan), node periyodik olarak (varsayılan 60 dakikada bir) bu reponun `main` branch'ini kontrol eder; yeni bir commit varsa ve node o an boştaysa (aktif render job'ı yoksa) `git pull --ff-only` + `npm install` + `npm run build` yapıp kendini kapatır — `com.pratiktools.render-node.plist`'teki `KeepAlive` sayesinde launchd onu yeni koda otomatik olarak yeniden başlatır. Build başarısız olursa node otomatik olarak önceki çalışan commit'e geri döner (rollback), asla bozuk bir sürümde takılı kalmaz.

Bu, `config.json`'daki `autoUpdate` alanıyla kontrol edilir:
```json
"autoUpdate": { "enabled": true, "checkIntervalMinutes": 60, "branch": "main" }
```
Kapatmak istersen `enabled: false` yap veya alanı tamamen sil.

## 2. Cloudflare Tunnel oluştur (bir kere, panelden)

Render node'lar NAT arkasında/ev-ofis ağlarında çalışabildiği için, Laravel'in bu node'a ulaşabilmesi bir Cloudflare Tunnel üzerinden sağlanıyor — port yönlendirme veya sabit IP gerekmiyor.

1. https://one.dash.cloudflare.com adresine git.
2. **Networks > Tunnels > Create a tunnel**.
3. Connector tipi: **Cloudflared**. Tünele bir isim ver (örn. `render-node-1`).
4. Kurulum ekranında gösterilen komuttaki token'ı (`eyJ...` ile başlayan uzun metin) kopyala — bu, `config.json`'daki `pushServer.tunnelToken` alanı.
5. **Public Hostname** sekmesinde:
   - Subdomain: örn. `render-node-1`
   - Domain: **kendi Cloudflare hesabınıza ait bir alan adı** (bu listede yalnızca sizin hesabınıza eklenmiş domain'ler görünür — `motioncurate.com` bizim hesabımıza kayıtlı olduğu için sizin listenizde çıkmaz; sahibi olduğunuz herhangi bir domain'i önce Cloudflare hesabınızda **Websites** bölümünden ekleyip burada onu seçin)
   - Type: `HTTP`
   - URL: `localhost:4790` (veya `config.json`'da seçtiğin `pushServer.port`)
6. Kaydet.

Bu node'un `callback_url`'i artık `https://render-node-1.<sizin-domaininiz>/render-jobs/notify` olacak (yol kısmı sabit — `render-jobs/notify`). Doğrulama (`CallbackUrlValidator`) yalnızca `https://`, public bir IP'ye çözülen bir host ve kimlik bilgisi içermeyen bir URL şartı arıyor — motioncurate.com'a özel bir kısıtlama yok, herhangi bir domain'iniz kabul edilir.

## 3. Node'u Laravel'e kaydet

**Author/community node (kendi makinenle katkıda bulunuyorsan):** admin komutuna ihtiyacın yok. MotionCurate author panelinde "Render Node'larım" → "Render Node Ekle" ile tek kullanımlık bir Registration Token al, sonra `npm run configure` çalıştırdığında sorulan "Registration Token" sorusuna bu token'ı yapıştır — `nodeUuid`/`apiSecret` otomatik olarak alınıp `config.json`'a yazılır, aşağıdaki admin adımını atlayabilirsin. Callback URL'i (bölüm 2'de kurduğun Cloudflare Tunnel hostname'i) daha sonra aynı panelden gireceksin — bir admin onayladıktan sonra node render işi almaya başlar.

**Platform node (admin/SSH erişimi olan biri kaydediyorsa):**

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
- **Otomatik güncelleme çalışmıyor:** `logs/` altında "Self-update" ile başlayan satırları kontrol et. En sık sebep: klasör `git clone` değil elle kopyalanmış (git remote'u yok) - bu durumda `git remote -v` boş döner, klasörü yeniden `git clone` ile kurman gerekir.
