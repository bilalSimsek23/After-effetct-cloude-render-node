# Faz 8A — Gerçek Adobe JSX Runtime (Variable Engine, Render Queue & Media Encoder)

Bu fazın amacı Faz 5'in bıraktığı iskeletleri (`apply-variables.jsx`, `queue-media-encoder.jsx`, `save-project.jsx`, `WaitRenderStage`, `CollectOutputStage`) gerçek, uçtan uca çalışan bir Adobe otomasyon katmanına dönüştürmekti: gerçek bir `.aep` → gerçek `manifest.json` → gerçek `variables.json` → gerçek property değişimi → gerçek render → gerçek çıktı dosyası → gerçek upload → hash doğrulama → `COMPLETED`. Hiçbir Contract değiştirilmedi, Execution Pipeline'ın stage sırası/isimleri aynı kaldı, `ProjectPreparationService`/`RenderBroker`/Contract Registry/Capability Registry dokunulmadı — yalnızca eksik Adobe davranışları tamamlandı.

Bu faz, planlanandan çok daha fazla **gerçek, beklenmeyen platform bulgusu** ortaya çıkardı — her biri gerçek After Effects/Media Encoder'a karşı ampirik olarak doğrulandı, hiçbiri varsayımla bırakılmadı. Bu rapor hem nihai mimariyi hem de bu bulguları ayrıntılı olarak belgeliyor, çünkü bunlar gelecekteki herhangi bir Adobe otomasyon çalışmasını doğrudan etkileyecek gerçek platform sınırları.

---

## 1. Genel Mimari

```
variables.json + manifest.json
        │  (VariableResolver, Node/TS)
        ▼
resolved-variables.json  →  apply-variables.jsx  →  PropertyResolver (layerName + propertyPath)
        │                                                 │
        │                                        VariableHandlers tablosu (switch-case yok)
        ▼
save-project.jsx  →  queue-media-encoder.jsx (AE'nin KENDİ render queue'su, applyTemplate + renderAsync)
        │
        ▼
WaitRenderStage → check-render-status.jsx (RQItemStatus: DONE/ERR_STOPPED) + dosya boyutu (yedek sinyal)
        │
        ▼
CollectOutputStage (gerçek stat + sha256) → UploadOutputStage (gerçek HTTP PUT) → CleanupStage
```

### 1.1 Korunan sınırlar

- Hiçbir Contract değişmedi.
- `ExecutionPipeline` sınıfı ve stage sırası/isimleri aynı kaldı; yalnızca `ApplyVariablesStage`'in çağırdığı motor (`AfterEffectsEngine.applyVariables`) ve `QueueRenderStage`/`WaitRenderStage`'in çağırdığı motor (`MediaEncoderEngine`) gerçek implementasyona kavuştu.
- `ProjectPreparationService`, `RenderBroker`, Contract Registry, Capability Registry dokunulmadı.
- `ProgressService`/ilerleme sistemi değişmedi.

---

## 2. Variable Engine

### 2.1 VariableResolver (Node/TS)

`src/jsx/variable-resolver.ts` — `variables.json` (gerçek değerler) + `manifest.json` (Contract, `TemplateVariableContract[]`) → tek, tip-normalize edilmiş `resolved-variables.json`. Desteklenmeyen bir tip burada, herhangi bir Adobe round-trip'inden ÖNCE reddedilir (`UnsupportedVariableTypeError`).

**Mimari karar — Essential Graphics'ten vazgeçiş:** İlk tasarım, her değişkenin Essential Graphics (EGP) üzerinden bir "scanner key" ile bulunmasını öngörüyordu (Motion Graphics Template mantığı). Gerçek testler bunun bu AE sürümünde **çalışmayan bir platform sınırı** olduğunu kanıtladı (bkz. §4.1). Bunun yerine, manifest'in `metadata` alanı gerçek bir AE adresi taşıyor:

```ts
export interface ResolvedVariableEntry {
  key: string;
  type: VariableType;
  value: unknown;
  layerName: string;
  propertyPath: string[]; // IMAGE/VIDEO/AUDIO için boş
}
```

`metadata.layerName`/`metadata.propertyPath` eksikse `PropertyAddressResolutionError` (yeni, Node-side, Adobe round-trip'inden önce).

### 2.2 PropertyResolver (JSX)

`src/jsx/apply-variables.jsx` içinde: layer adını cache'leyen (negatif sonuçlar dahil), sonra `layer.property(path[0]).property(path[1])...` şeklinde standart AE property gezintisi yapan bir resolver. Aynı layer'daki birden fazla değişken projeyi tekrar taramaz.

### 2.3 Handler tablosu (Open/Closed)

`VariableHandlers` nesne literal'i — `switch-case` yok, yeni tip eklemek tek bir handler kaydı demek. 11 tip: TEXT, NUMBER, ANGLE, DROPDOWN, BOOLEAN, COLOR, POINT2D, POINT3D, IMAGE, VIDEO, AUDIO (VIDEO/AUDIO, IMAGE ile aynı fonksiyonu paylaşır — gerçekten aynı kod yolu, "muhtemelen aynı" değil).

- **TEXT**: `prop.value` üzerinden gerçek `TextDocument`, font doğrulaması (§4.3), `.text` değişir, `setValue`.
- **NUMBER/ANGLE/DROPDOWN**: `Number(value)` + `setValue`.
- **BOOLEAN**: `setValue(value ? 1 : 0)`.
- **COLOR**: hex → RGBA float dizisi (`#RRGGBB[AA]` → `[r,g,b,a]/255`) veya doğrudan dizi.
- **POINT2D/POINT3D**: dizi uzunluğu doğrulanır, `setValue`.
- **IMAGE/VIDEO/AUDIO**: `AssetImporter.replaceLayerSource` — import-or-reuse + `replaceSource`, layer adıyla (Essential Graphics değil).

### 2.4 JSON serileştirme

Gerçek testlerde bu After Effects sürümünün ExtendScript motorunda **`JSON` global'i yok** (`typeof JSON === 'undefined'`). Okuma tarafı zaten güvenli bir `eval()` fallback'ine sahipti; yazma tarafı için el yazması, ES3-uyumlu bir `toJsonString()`/`jsonEscapeString()` serileştiricisi eklendi.

---

## 3. Render Queue & Media Encoder — mimari dönüş

Bu fazın en büyük, planlanmamış keşfi burada oldu. Orijinal spesifikasyon `queueInAME()` üzerinden Media Encoder'a gerçek bir hand-off öngörüyordu; gerçek testler bunun **güvenilmez** olduğunu kanıtladı ve mimari AE'nin kendi render queue'sunu kullanacak şekilde değiştirildi.

### 3.1 Denenen ve terk edilen yol: `queueInAME()`

`app.project.renderQueue.queueInAME(true)` — dokümante edilmiş, "doğru" yol. Gerçek testler şunu kanıtladı:

- AE tarafında `outputModule.applyTemplate('H.264 - Match Render Settings - 5 Mbps')` çağrısından hemen sonra `outputModule.getSettings()['Format']` **"H.264"** gösteriyordu — ayar doğru uygulanmıştı.
- Ama `queueInAME()` ile Media Encoder'a gönderilen öğe, Media Encoder'ın kendi kuyruk panelinde (kullanıcının ekran görüntüleriyle doğrulandı) hâlâ makinenin **ortam varsayılanı** (bu durumda "GIF Animasyon") ile görünüyordu — AE'nin uyguladığı ayar AME'ye hiç yansımıyordu.
- Media Encoder'ın kendi Preset Browser'ındaki (`.epr`, gerçek dosya yolu bulundu: `~/Documents/Adobe/Adobe Media Encoder/26.0/Presets/*.epr`) kullanıcı preset'leri `outputModule.templates` listesinde **hiç görünmüyor** — `applyTemplate()` bunları isimle de seçemiyor.
- `.epr` dosyasının içeriği incelendi: Premiere/AME'nin kendi `PremiereData`/`ExportParamContainer` XML formatı — AE'nin basit `{Format: "H.264", ...}` sözlük yapısıyla uyumsuz, elle çevrilmesi gerçekçi değil.
- `RenderQueueItem`/`RenderQueue` reflect edildi (`renderQueueMethods=item,pauseRendering,queueInAME,render,renderAsync,showWindow,stopRendering`) — AME'nin preset seçimine erişen hiçbir metod yok.

**Sonuç:** ExtendScript'ten Media Encoder'ın kendi preset seçimini kontrol etmenin **hiçbir yolu yok** — bu, kod ile aşılamayan, gerçek testle kesinleşmiş bir platform sınırı.

### 3.2 Gerçek çözüm: AE'nin kendi render queue'su

`app.project.renderQueue.renderAsync()` — Media Encoder'a hiç gitmeden, doğrudan After Effects içinde render. Gerçek testle doğrulandı: `ffprobe` ile gerçek H.264, doğru çözünürlük/süre. `queue-media-encoder.jsx` (isim korundu — Stage/Engine sınırı bundan etkilenmiyor) artık:

1. Render queue item ekler, `outputModule.file` atanır.
2. `applyTemplate(preset)` çağrılır — başarı/başarısızlık **asla sessiz yutulmaz**, rapora yazılır (`templateStatus`), Node tarafında başarısızsa uyarı loglanır. (Bir önceki, sessizce yutan versiyon, tam da bu bug'ı — GIF'e düşme — aylarca gizli tutabilirdi; gerçek testte bunu bulmak, bir boşluk karakteri eksikliği yüzünden ["H.264 - Match Render Settings - 5 Mbps" yerine gerçek isim çift boşluklu: "H.264 - Match Render Settings - 5 Mbps"] saatler sürdü.)
3. Gerçek nihai yol (`outputModule.file.fsName`) okunur — AE, atanan uzantıyı sessizce ortamın/şablonun gerçek formatına göre değiştirebiliyor (`.mov` → `.mp4`, hatta bir denemede `.gif`).
4. `renderAsync()` çağrılır (senkron değil — Node, dosya/duruma bakarak takip eder).

`RenderProfileRegistry` artık gerçek, built-in AE Output Module şablon isimleri taşıyor (`mediaEncoderPreset: null` placeholder'ı tamamlandı):

```ts
PREVIEW: 'H.264 - Match Render Settings -  5 Mbps'; // dikkat: çift boşluk
MASTER: 'H.264 - Match Render Settings - 40 Mbps';
```

### 3.3 Gerçek durum izleme (Queued/Rendering/Done/Failed)

Orijinal spesifikasyon "gerçek Media Encoder Queue durum izleme" istiyordu. AME'ye artık hiç gidilmediği için, bu AE'nin KENDİ render queue item'ının gerçek `status` özelliği (`RQItemStatus`) ile karşılanıyor — daha önce mümkün olmayan, şimdi tam olarak istenen davranış:

- Yeni `check-render-status.jsx` — `app.project.renderQueue.item(index).status` okur, rapora yazar.
- `MediaEncoderEngine.waitForRenderCompletion()` her pollde önce bu durumu sorar: `ERR_STOPPED` (3018) → anında `RenderFailedError`; `DONE` (3019) → anında başarı. Dosya boyutu stabilitesi yalnızca yedek/ikincil sinyal.
- **Neden önemli:** Gerçek testte, bozuk bir kaynak görüntü render'ı anında başarısız kıldı, ama çıktı dosyası hiç oluşmadığı için eski (yalnızca dosya-tabanlı) izleme bunu "hâlâ render ediyor" sanıp **tam 10 dakika** boşuna bekleyip yanıltıcı bir "zaman aşımı" hatası verdi. Gerçek durum kontrolü bunu ~2-3 saniyeye indirdi.

---

## 4. Gerçek Testlerde Bulunan Platform Sınırları ve Çözümleri

Her biri gerçek After Effects 2026 / Media Encoder 2026'ya karşı ampirik olarak doğrulandı.

### 4.1 Essential Graphics: yazılabilir ama okunamaz

- `property.addToMotionGraphicsTemplate(comp)` / `addToMotionGraphicsTemplateAs(comp, name)` — gerçek, çalışıyor (bir controller ekliyor).
- `comp.setMotionGraphicsControllerName(index, name)` — gerçek, çalışıyor, ismi gerçekten değiştiriyor.
- `comp.motionGraphicsTemplateController(index)` — **yok** (varsayılan API, gerçekte mevcut değil).
- `comp.reflect.methods` ile doğrulanan tam metod listesi: `exportAsMotionGraphicsTemplate, getMotionGraphicsTemplateControllerName, openInEssentialGraphics, setMotionGraphicsControllerName` — controller'dan gerçek bir `Property` nesnesi geri almanın **hiçbir yolu yok**.

**Çözüm:** PropertyResolver, EGP'yi tamamen bypass edip `layerName` + `propertyPath` (manifest `metadata`'sından) üzerinden standart AE property gezintisi yapıyor (§2.2).

### 4.2 `File.write()` satır sonu

ExtendScript'in `File.write()`'ı, host OS ne olursa olsun `\r` (Macintosh tarzı) satır sonu kullanıyor — Node tarafında düz `\n` ile `split()` sessizce bozuluyordu (rapor alanları birbirine karışıyordu). **Çözüm:** çok alanlı raporlarda `\n` yerine `|` (pipe) ayracı.

### 4.3 Font doğrulama

İlk yaklaşım — bağımsız bir `new TextDocument('Aa')` üzerinde `.font` atayıp okumak — şu hatayı veriyordu: _"Unable to set value as it is not associated with a layer."_ Bağımsız (layer'a bağlı olmayan) bir `TextDocument`, herhangi bir property atamasını reddediyor. Gerçek property'den türetilen (`prop.value`) bir kopya üzerinde ise `.font` ataması sorunsuz çalışıyor ama **hiçbir doğrulama sağlamıyor** — AE, geçersiz bir font adını bile sessizce kabul edip geri okuyor (commit edilmeden).

**Gerçek çözüm:** `app.fonts.getFontsByPostScriptName(name)` — gerçek, salt-okunur, invaziv olmayan bir API. Kurulu bir font için dönen `Font` nesnesinin `isSubstitute` alanı `false`; kurulu olmayan bir isim için AE yine bir nesne döndürür (istenen ismi yankılar) ama `isSubstitute: true` ile işaretler. Bu ayrım, gerçek bir Helvetica ile uydurma bir font adı yan yana test edilerek doğrulandı.

### 4.4 Output Module uzantısı/formatı ortam bağımlı

`outputModule.file = new File(...)` ile atanan yol, AE tarafından **sessizce** o anki (veya uygulanan) şablonun gerçek konteyner formatına göre yeniden yazılıyor — `.mov` isteyip `.mp4` almak, hatta bir denemede `.gif` almak. **Çözüm:** gerçek nihai yol her zaman `outputModule.file.fsName`'den geri okunup Node'a raporlanıyor (§3.2), asla önceden varsayılmıyor.

### 4.5 `applyTemplate()` boşluk hassasiyeti

Gerçek şablon adı tek haneli bitrate'lerde **çift boşluk** içeriyor: `"H.264 - Match Render Settings -  5 Mbps"` (15/40 Mbps'te tek boşluk). Bu tek karakterlik fark, `applyTemplate()`'in sessizce (yakalanan hata olarak) başarısız olmasına ve kuyruğun ortam varsayılanına (bir noktada GIF) düşmesine yol açtı — saatlerce süren bir teşhis sürecinin kök nedeniydi.

### 4.6 `app.newProject()`/`app.open()` ve kaydetmeden kapatma diyaloğu

Gerçek kullanım sırasında (kullanıcı tarafından bildirildi): önceki, kaydedilmemiş bir proje açıkken `app.newProject()`/`app.open()` çağırmak "Kaydetmek ister misiniz?" diyaloğunu tetikleyip script'i süresiz bloke edebiliyor. Bu, **gerçek bir üretim riski**: `CleanupStage`, `AdobeSession.dispose()`'u çağırıyor ama proje ASLA kapatılmıyor (kasıtlı — "gerçek silme işlemi yapılmayacaktır" notu); bir job save'den önce başarısız olursa, AE kaydedilmemiş değişikliklerle açık kalıyor, bir SONRAKİ job'ın `openProject()`'i bu diyaloğa çarpıp sonsuza dek asılı kalıyor.

**Çözüm:** `AfterEffectsEngine.openProject()` artık her zaman önce `if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }` çalıştırıyor — önceki job nasıl bittiyse bitsin, her job temiz bir sayfadan başlıyor. Aynı desen tüm test scriptlerinin kendi proje-oluşturma adımlarına da uygulandı.

### 4.7 Test PNG bozukluğu (kod hatası, platform sınırı değil)

`render-check.ts`'in elle yazılmış "minimal PNG" hex verisinde bir transkripsiyon hatası vardı (bozuk IDAT/CRC). `ReplaceSource` bunu sorunsuz kabul etti (piksel verisini asla decode etmiyor) ama render anında gerçek hata verdi: _"PNGIO library error: IDAT: incorrect data check."_ Bu, sorunun yalnızca render zamanında ortaya çıkması nedeniyle teşhisi zor bir hataydı. **Çözüm:** iyi bilinen, doğrulanmış bir 1x1 PNG'nin base64 formundan decode edilmesi (elle hex yazmak yerine).

---

## 5. Diğer Değişiklikler

- **UploadService** (kullanıcı onayıyla): artık gerçek bir yerel HTTP `PUT` yapıyor (`uploadBaseUrl` verilirse); verilmezse (varsayılan, mevcut deploy'ları etkilemez) eski no-op stub davranışını koruyor. `RenderNodeConfig.uploadEndpoint` (opsiyonel) eklendi.
- **CollectOutputStage**/**WaitRenderStage**: Faz 5'in mock/iskelet halinden gerçek `stat` + `sha256` ve gerçek durum izlemesine tamamlandı.
- `.prettierignore` eklendi: `src/jsx/*.jsx` ExtendScript dosyaları, gerçek JSX/React olmadıkları ve `#include` gibi geçerli-olmayan-JS sözdizimi içerdikleri için prettier'ın parser'ından hariç tutuldu.

---

## 6. Gerçek Test: `npm run check:render`

`src/render-check.ts` — sekiz değişken tipinin tamamını (TEXT, NUMBER, ANGLE, BOOLEAN, COLOR, POINT2D, POINT3D, IMAGE) tek bir gerçek projede kapsayan uçtan uca senaryo:

1. Gerçek `.aep`: bir comp, bir metin layer'ı (Checkbox Control + Color Control efektleriyle), ayrı bir 3D layer (POINT3D testi için — Anchor Point'in 2D kalabilmesi için TitleLayer'dan izole edildi; AE, 3D bir layer'da 2D property'leri bile 3 bileşenli — z=0 — döndürüyor, bu gerçek ve tutarlı bir davranış), gerçek bir PNG'den import edilmiş bir görüntü layer'ı.
2. Gerçek `manifest.json` (`metadata.layerName`/`propertyPath` ile) + gerçek `variables.json`.
3. `AfterEffectsEngine.applyVariables()` — gerçek, hem normal hem Dry Run modda.
4. Uygulanan değerler AE'den **geri okunarak** doğrulandı (rapor "hata yok" demek "değer değişti" demek değildir).
5. Tam `ExecutionPipeline` — Load → ApplyVariables → Save → QueueRender → Wait → CollectOutput → Upload → Cleanup, gerçek After Effects'e karşı.
6. Gerçek yerel HTTP sunucusu — yüklenen baytları diske yazıp gerçek hash'ini hesaplıyor.
7. Yerel render çıktısının hash'i ile yüklenen dosyanın hash'i **karşılaştırılıp doğrulandı**.

**Sonuç:** `TÜM RENDER DOĞRULAMA SENARYOLARI BAŞARILI`, `status: COMPLETED`, gerçek dosya boyutu/hash, gerçek upload URL'i, hash eşleşmesi doğrulandı.

---

## 7. Regresyon

Tam regresyon, bu fazın hiçbir mevcut davranışı bozmadığını doğrulamak için çalıştırıldı:

| Komut                        | Sonuç                                                           |
| ---------------------------- | --------------------------------------------------------------- |
| `npm run typecheck`          | ✅ temiz                                                        |
| `npm run lint`               | ✅ temiz                                                        |
| `npm run build`              | ✅ temiz                                                        |
| `npx prettier --check .`     | ✅ temiz (`.prettierignore` eklendikten sonra)                  |
| `npm run check:contracts`    | ✅                                                              |
| `npm run check:dependency`   | ✅                                                              |
| `npm run check:capabilities` | ✅                                                              |
| `npm run check:preparation`  | ✅                                                              |
| `npm run check:scheduler`    | ✅                                                              |
| `npm run check:adobe`        | ✅                                                              |
| `npm run check:execution`    | ✅ (düzeltme sonrası — bkz. §7.1)                               |
| `npm run check:orchestrator` | ✅ (gerçek Laravel-şekilli sunucuya karşı, gerçek render dahil) |
| `npm run check:render`       | ✅ (yeni, bu fazın ana teslimatı)                               |

### 7.1 Regresyonda bulunan ve düzeltilen bir regresyon

`execution-check.ts`'in en baştaki "JSX Runtime doğrudan doğrulama" bloğu, `apply-variables.jsx` ve `save-project.jsx`'i yalnızca `{ markerFilePath }` ile (gerçek `variablesFile`/`reportFile` veya açık bir proje olmadan) çağırıyordu — bu, her iki dosyanın da hâlâ Faz 5'in marker-yazan iskeletleri olduğu varsayımına dayanıyordu. Bu faz onları gerçek implementasyona kavuşturduğu için, bu marker-only çağrı artık gerçekten çalışmaya çalışıp (`payload.variablesFile` tanımsız olduğu için) hata veriyor ve — kullanıcının ekranında gerçek bir AE hata diyaloğu olarak görünüp — sonraki denemeleri de bloke ediyordu. **Düzeltme:** `APPLY_VARIABLES`/`SAVE_PROJECT`, bu marker listesinden çıkarıldı (hâlâ gerçek iskelet olan `OPEN_PROJECT`/`CLOSE_PROJECT` kaldı) — gerçek davranışları zaten bu scriptin devamındaki tam pipeline koşusunda ve `check:render`'da test ediliyor.

---

## 8. Faz Sonunda Beklenen Durum — Doğrulama Özeti

- Gerçek Variable Engine: 11 tip, layerName+propertyPath adresleme, font doğrulama, dry run, uygulama raporu — hepsi gerçek AE'ye karşı doğrulandı.
- Gerçek Render: AE'nin kendi render queue'su üzerinden, gerçek durum izleme (Done/Failed anında tespit ediliyor), gerçek çıktı dosyası.
- Gerçek Upload + hash doğrulama.
- Hiçbir Contract, Stage sırası, veya korunan servis değişmedi.
- Tam regresyon yeşil.
- Üretimde gizli kalabilecek üç gerçek risk bulunup düzeltildi: (a) sessizce yutulan `applyTemplate()` hataları, (b) job'lar arası kaydetmeden-kapatma diyaloğu riski, (c) render başarısızlığının 10 dakikalık zaman aşımıyla karışması.

Bu fazın en önemli mimari sonucu: **Media Encoder artık render yoluna hiç dahil değil** — After Effects kendi render queue'sunu kullanıyor, çünkü bu, ExtendScript'ten gerçekten kontrol edilebilen tek yol olduğu ampirik olarak kanıtlandı.
