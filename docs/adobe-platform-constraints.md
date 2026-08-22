# Adobe Platform Constraints — Kalıcı Mühendislik Referansı

Bu doküman, `pratiktools-render-node`'un Adobe After Effects / Media Encoder otomasyonu geliştirilirken **gerçek testle** keşfedilen platform sınırlarının kalıcı, konu bazlı referansıdır. Faz raporları (`phase-*.md`) bu bulguları kronolojik olarak anlatır; bu doküman aynı bulguları **konuya göre** organize eder ve gelecekteki geliştiricilerin "neden böyle yapıldı" sorusuna tek bir yerden cevap bulmasını sağlar.

**Test edilen ortam** (aksi belirtilmedikçe tüm bulgular bu ortamda doğrulanmıştır): macOS, Adobe After Effects 2026 (sürüm 26.3.0), Adobe Media Encoder 2026 (sürüm 26.3.1). Farklı sürümlerde bu davranışların aynı olup olmadığı **doğrulanmamıştır** — varsayılmamalıdır.

---

## 1. DoScript'in dönüş değeri gerçek değil

**Açıklama:** AppleScript üzerinden `DoScript` ile çalıştırılan bir ExtendScript'in dönüş değeri, script'in son ifadesinin değeri **değildir** — yalnızca bir durum kodudur.

**Etkilenen Adobe sürümleri:** After Effects 2026 (26.3.0). Muhtemelen tüm sürümlerde aynı (bu, AppleScript↔ExtendScript köprüsünün genel bir özelliği), ama yalnızca bu sürümde doğrulandı.

**Nasıl doğrulandı:** `DoScript "1+1;"` gibi basit ifadeler her zaman aynı durum kodunu döndürdü; script içinde gerçek bir sonuç üretip geri okumak için ayrı bir dosyaya yazdırılıp Node tarafından okunması gerektiği ampirik olarak doğrulandı.

**Etki:** Herhangi bir JSX script'in "gerçek sonucunu" Node'a geri iletmenin tek güvenilir yolu, script'in kendisinin bir dosyaya yazması ve Node'un o dosyayı okumasıdır.

**Mimari karar:** Tüm JSX script'leri (`apply-variables.jsx`, `queue-media-encoder.jsx`, `check-render-status.jsx`, `save-project.jsx` vb.) yapılandırılmış sonuçlarını her zaman gerçek bir "rapor dosyası"na yazar; Node bu dosyayı okuyarak sonucu öğrenir. DoScript'in kendi dönüş değeri hiçbir zaman anlamlı bir sonuç olarak kullanılmaz.

**Workaround:** Yok — bu, mimarinin kalıcı bir parçası (marker/report dosyası deseni).

---

## 2. Media Encoder'ın kendi DoScript yüzeyi scriptli çağrıyı reddediyor

**Açıklama:** Adobe Media Encoder uygulamasına doğrudan (After Effects üzerinden değil) `DoScript`/`#include` tabanlı bir ExtendScript çalıştırma denemesi gerçek bir sözdizimi hatasıyla reddediliyor.

**Etkilenen sürümler:** Media Encoder 2026 (26.3.1).

**Nasıl doğrulandı:** Doğrudan Media Encoder'a yönelik bir `DoScript` çağrısı gerçek bir hata döndürdü (Faz 5/7).

**Etki:** Media Encoder'a herhangi bir otomasyon Media Encoder'ın KENDİSİNE değil, After Effects'in ExtendScript motoruna yazılmalı (After Effects'in kendi `renderQueue` API'leri üzerinden).

**Mimari karar:** Tüm render otomasyonu After Effects'e karşı çalışır; Media Encoder hiçbir zaman doğrudan script hedefi olarak kullanılmaz.

**Workaround:** Yok, gerekmedi — After Effects'in kendi render queue'su (bkz. §9) zaten yeterli.

---

## 3. ExtendScript motorunda `JSON` global'i yok

**Açıklama:** Bu After Effects sürümünün ExtendScript motorunda `JSON` global nesnesi tanımlı değil (`typeof JSON === 'undefined'`).

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** Doğrudan `JSON.stringify()`/`JSON.parse()` çağrıları başarısız oldu; izole `osascript` testleriyle `typeof JSON` sorgulanarak kesinleşti.

**Etki:** JSX script'leri içinde JSON okuma/yazma için elle yazılmış bir çözüm gerekiyor.

**Mimari karar:** Okuma tarafı `eval('(' + content + ')')` (güvenli, çünkü içerik her zaman kendi ürettiğimiz veri); yazma tarafı el yazması, ES3-uyumlu bir `toJsonString()`/`jsonEscapeString()` serileştiricisi (`apply-variables.jsx` içinde).

**Workaround:** Yukarıdaki elle yazılmış serileştirici — kalıcı çözüm, geçici değil.

---

## 4. Essential Graphics: `motionGraphicsTemplateController()` yok, ama gerçek okuma yolu var (sandbox comp + `essentialPropertySource`)

**Açıklama:** `property.addToMotionGraphicsTemplate(comp)`/`addToMotionGraphicsTemplateAs(comp, name)` ve `comp.setMotionGraphicsControllerName(index, name)` gerçek ve çalışıyor (bir controller ekleyip isimlendirebiliyorsunuz). `comp.motionGraphicsTemplateController(index)` gibi bir controller'dan gerçek bir `Property` nesnesi geri alma metodu doğrudan **yok** — bu ilk bulgu (Faz 8A) doğruydu. Ancak bu, Essential Graphics'in tamamen "yazılabilir, okunamaz" olduğu anlamına gelmiyor: gerçek üretim Scanner'ı (`generate_manifest.jsx`), published bir EGP controller'ın arkasındaki gerçek property'yi **farklı, dolaylı bir mekanizmayla** okuyor.

**Gerçek çalışan mekanizma (Faz 8C'de üretim referans dosyalarıyla doğrulandı):** Bir layer'ın `essentialPropertySource` bağlantısı, o layer'ı barındıran comp **başka bir comp içine layer olarak nest edilmediği sürece** `null` döner — kendi comp'ünde `essentialPropertySource`'u doğrudan okumaya çalışmak (Faz 8A'daki ilk test) bu yüzden hep boş sonuç veriyordu. Gerçek Scanner şu adımları izliyor:

1. Geçici (throwaway) bir "sandbox" comp oluşturur.
2. Taranacak her gerçek comp'u bu sandbox comp'a bir layer olarak nest eder (`tempComp.layers.add(comp)`).
3. O nested layer'ın `"ADBE Layer Overrides"` property group'unu okur — bu group, YALNIZCA nesting sonrası dolar ve published EGP controller'larına karşılık gelen "override proxy" property'leri içerir.
4. Bu group'u (klasörler düz `PropertyGroup`, sadece `PropertyType.PROPERTY` yaprakları) recursive gezerek her yaprağın `essentialPropertySource`'unu okur — bu, controller'ın arkasındaki GERÇEK property'yi döndürür.
5. O gerçek property'den `.parentProperty` zinciriyle yukarı çıkarak gerçek layer'ı ve `containingComp`'unu bulur (gerçek layer başka bir nested comp'ta yaşayabilir — dıştaki döngünün comp'u değil, `sourceLayerObj.containingComp.name` kullanılır).
6. Aynı property birden fazla nesting seviyesinden yeniden expose edilebildiği için `compositionName|layerName|propertyPath` üçlüsüyle deduplicate edilir.

**Etkilenen sürümler:** After Effects 2026 (26.3.0). `app.version` kontrolü ile ≥ 22.0 gerektiriyor (üretim Scanner'ında).

**Nasıl doğrulandı:** İlk bulgu (`comp.reflect.methods` ile `CompItem`'ın tam metod listesinin çıkarılması — `exportAsMotionGraphicsTemplate, getMotionGraphicsTemplateControllerName, openInEssentialGraphics, setMotionGraphicsControllerName`, property döndüren hiçbir metod yok) Faz 8A'da doğrulandı ve hâlâ geçerli. Sandbox-nesting mekanizması ise Faz 8C'de kullanıcının paylaştığı gerçek üretim dosyaları (`generate_manifest.jsx`, `apply_manifest.jsx`, örnek `manifest.json`) okunarak analiz edildi — bu, gerçek, üretimde çalışan bir mekanizma, varsayım değil.

**Etki:** Essential Graphics tabanlı değişken KEŞFİ (Scanner tarafı) gerçek ve mümkün — ama bu Render Node projesinin kapsamı dışında (Scanner ayrı bir sistem). Render Node, manifest'e ulaştığında keşif zaten tamamlanmış olur; Essential Graphics'e hiç dokunmaz.

**Mimari karar:** `PropertyResolver` (Render Node, `apply-variables.jsx`), Essential Graphics'i hiçbir zaman kendisi okumaz/yazmaz — sadece Scanner'ın manifest'e yazdığı gerçek adresi (`metadata.compositionName` + `metadata.layerName` + `metadata.propertyPath`, opsiyonel `metadata.propertyMatchName`) üzerinden standart `comp.layer(name).property(path[0]).property(path[1])...` gezintisi yapar; bulunamazsa `apply_manifest.jsx`'in üretimde doğrulanmış fallback zincirini (matchName + displayName arama) birebir uygular. Detay için bkz. `docs/scanner-manifest-metadata-contract.md`.

**Workaround:** Yukarıdaki compositionName/layerName/propertyPath(+propertyMatchName) adresleme — kalıcı çözüm, Scanner↔Render Node arasındaki resmi sözleşme (ABI).

---

## 5. `File.write()` host OS'ten bağımsız olarak `\r` kullanıyor

**Açıklama:** ExtendScript'in `File` nesnesinin `.write()` metodu, host işletim sistemi ne olursa olsun Macintosh tarzı (`\r`) satır sonu karakteri kullanıyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0), macOS üzerinde.

**Nasıl doğrulandı:** Node tarafında çok-alanlı bir rapor dosyasını `\n` ile `split()` etmek sessizce başarısız oldu (tüm alanlar tek bir string'e karıştı); dosyanın gerçek baytları incelenerek `\r` kullanıldığı doğrulandı.

**Etki:** JSX'ten Node'a çok alanlı bir rapor yazarken `\n` tabanlı ayrıştırma güvenilmez.

**Mimari karar:** Çok alanlı raporlarda satır sonu yerine `|` (pipe) ayracı kullanılıyor.

**Workaround:** Pipe ayracı — kalıcı çözüm.

---

## 6. Font doğrulama: bağımsız `TextDocument` property atamasını reddediyor

**Açıklama:** `new TextDocument('Aa')` ile oluşturulan, herhangi bir layer'a bağlı olmayan bir `TextDocument` üzerinde `.font` gibi bir property atamak şu hatayı veriyor: _"Unable to set value as it is not associated with a layer."_ Gerçek bir property'den türetilen (`prop.value`) bir kopya üzerinde ise atama sorunsuz çalışıyor ama **hiçbir doğrulama sağlamıyor** — geçersiz bir font adını bile sessizce kabul edip geri okuyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** İki senaryo da izole `osascript` testleriyle doğrudan tekrarlandı.

**Etki:** "Font kurulu mu?" sorusunu invaziv olmayan, bağımsız bir prob ile cevaplamak mümkün değil.

**Mimari karar:** `app.fonts.getFontsByPostScriptName(name)` kullanılıyor — gerçek, salt-okunur bir API. Kurulu bir font için dönen `Font.isSubstitute` `false`; kurulu olmayan bir isim için AE yine bir nesne döndürür (istenen ismi yankılar) ama `isSubstitute: true` ile işaretler.

**Workaround:** `app.fonts` API'si — kalıcı, gerçek çözüm.

---

## 7. Output Module dosya uzantısı/formatı ortam bağımlı

**Açıklama:** `outputModule.file = new File(...)` ile atanan yol, AE tarafından **sessizce**, o anki (veya sonradan uygulanan) şablonun gerçek konteyner formatına göre yeniden yazılıyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** `.mov` istenip `.mp4` alındı; bir denemede (hiçbir şablon uygulanmadan, sadece makinenin geçmiş kullanımına bağlı olarak) `.gif` alındı.

**Etki:** Node'un önceden hesapladığı çıktı yolu güvenilir değil.

**Mimari karar:** Gerçek nihai yol her zaman `outputModule.file.fsName`'den (şablon uygulandıktan SONRA) geri okunup Node'a raporlanıyor, hiçbir zaman önceden varsayılmıyor.

**Workaround:** Geri okuma deseni — kalıcı çözüm.

---

## 8. `applyTemplate()` boşluk karakterine duyarlı

**Açıklama:** Gerçek AE Output Module şablon isimleri, tek haneli bitrate değerlerinde **çift boşluk** içerebiliyor (`"H.264 - Match Render Settings -  5 Mbps"`), iki haneli değerlerde tek boşluk (`"...  - 40 Mbps"` değil, `"... - 40 Mbps"`). Tek karakterlik bir fark `applyTemplate()`'in sessizce (yakalanan hata olarak) başarısız olmasına yol açıyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0) — bu tuhaf boşluklandırma muhtemelen Adobe'nin kendi şablon üretim mantığından kaynaklanıyor, sürüme özgü olabilir.

**Nasıl doğrulandı:** `om.templates` listesi tam karakterleriyle (köşeli parantez içinde) dökülüp karşılaştırıldı; yanlış isimle `applyTemplate()` gerçek bir "geçersiz şablon adı" hatası verdi.

**Etki:** Kod içinde (veya konfigürasyonda) yazılan bir şablon adındaki tek bir boşluk farkı, render'ın sessizce yanlış formatta çıkmasına yol açabilir.

**Mimari karar:** Şablon uygulama sonucu **asla sessizce yutulmuyor** — başarı/başarısızlık her zaman rapora yazılıyor, Node tarafında başarısızsa uyarı loglanıyor.

**Workaround:** Gerçek şablon adını `om.templates` listesinden (reflect ile) alıp tam olarak kopyalamak; şablon adlarını config'de tutup (bkz. Faz 8B) elle yazım hatasını en aza indirmek.

---

## 9. After Effects'in kendi render queue'su güvenilir, Media Encoder hand-off'u değil

**Açıklama:** `app.project.renderQueue.queueInAME(true)` ile Media Encoder'a gönderilen bir render, AE tarafında `applyTemplate()` ile doğru şekilde ayarlanmış Output Module ayarlarını (doğrulandı: `getSettings()['Format']` gerçekten "H.264" gösteriyordu) **tamamen görmezden geliyor** — Media Encoder, kendi arayüzünde bir insanın en son seçtiği preset'i kullanıyor (bu makinede bir noktada "Animated GIF"). Buna karşılık, `app.project.renderQueue.renderAsync()` ile **After Effects'in kendi içinde** render etmek, aynı Output Module ayarlarını güvenilir şekilde uyguluyor (`ffprobe` ile doğrulandı: gerçek H.264, doğru çözünürlük/süre).

**Etkilenen sürümler:** After Effects 2026 (26.3.0) / Media Encoder 2026 (26.3.1).

**Nasıl doğrulandı:** Kullanıcının Media Encoder arayüzünün ekran görüntüleriyle doğrudan gözlemlendi — AE tarafında ayarlar doğru olsa bile Media Encoder'ın kuyruk panelinde yanlış format görünüyordu. `renderAsync()`'e geçildikten sonra aynı proje `ffprobe` ile gerçek, doğru H.264 çıktısı üretti.

**Etki:** Media Encoder üzerinden render alma yolu, per-job encoding ayarlarının güvenilir kontrolünü imkansız kılıyor.

**Mimari karar:** **Media Encoder render yoluna hiç dahil edilmiyor.** After Effects kendi render queue'sunu (`renderAsync()`) kullanıyor. `AfterEffectsRenderEngine` (Faz 8B'de yeniden adlandırıldı) Media Encoder uygulamasının kurulum/çalışma durumunu hâlâ raporluyor (Environment Check/Capability Registry için) ama render işlemi için Media Encoder'a hiç gitmiyor.

**Workaround:** `renderAsync()` — kalıcı, mimari düzeyde çözüm.

---

## 10. Media Encoder'ın kendi Preset Browser preset'leri ExtendScript'e görünmüyor

**Açıklama:** Media Encoder'ın kendi Preset Browser'ında (kullanıcı tarafından) oluşturulan gerçek, isimlendirilmiş preset'ler, After Effects'in `outputModule.templates` listesinde **hiç görünmüyor** ve `applyTemplate()` bu isimlerle çağrıldığında "geçersiz şablon adı" hatası veriyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0) / Media Encoder 2026 (26.3.1).

**Nasıl doğrulandı:** Kullanıcı gerçek olarak `MC_proxy_mp4` ve `MC_HD_mp4` adlı iki preset oluşturdu; `om.templates` listesi bu isimleri içermiyordu, `applyTemplate('MC_proxy_mp4')` gerçek bir hata verdi.

**Etki:** Media Encoder'ın kendi preset sistemi ile AE'nin Output Module şablon sistemi **tamamen ayrı, birbirinden habersiz iki kayıt**.

**Mimari karar:** AE'nin KENDİ Output Module şablonları (built-in veya AE'nin "Save As Template" ile kaydettiği) kullanılıyor; Media Encoder'ın Preset Browser'ı render otomasyonunda hiç kullanılmıyor.

**Workaround:** Yok — bu, ExtendScript'ten aşılamayan gerçek bir platform sınırı. (Bkz. §11, neden `.epr` dosyasını doğrudan okumanın da işe yaramadığı.)

---

## 11. `.epr` dosyaları AE'nin Output Module ayarlarıyla uyumsuz bir format kullanıyor

**Açıklama:** Media Encoder'ın Preset Browser'ındaki `.epr` dosyaları (`~/Documents/Adobe/Adobe Media Encoder/<sürüm>/Presets/*.epr`), Premiere/Media Encoder'ın kendi `PremiereData`/`ExportParamContainer` XML formatını kullanıyor — AE'nin Output Module'ünün `getSettings()`/`setSettings()` ile kullandığı basit `{Format: "H.264", ...}` sözlük yapısıyla **uyumsuz**.

**Etkilenen sürümler:** Media Encoder 2026 (26.3.1).

**Nasıl doğrulandı:** Gerçek bir `.epr` dosyasının ham içeriği okunup incelendi — karmaşık, exporter'a özel parametre ID'leri içeren bir XML yapısı, basit anahtar-değer eşlemesine elle çevrilmesi gerçekçi değil.

**Etki:** `.epr` dosyasını okuyup AE'nin `setSettings()`'ine manuel çevirme fikri terk edildi.

**Mimari karar:** §9'daki çözüm (AE'nin kendi render queue'su + built-in Output Module şablonları) yeterli olduğu için bu yola hiç girilmedi.

**Workaround:** Yok, gerekmedi.

---

## 12. Kaydedilmemiş proje + `app.newProject()`/`app.open()` = süresiz asılı kalma riski

**Açıklama:** Kaydedilmemiş değişiklikleri olan bir proje açıkken `app.newProject()` veya `app.open()` çağırmak, After Effects'in "Kaydetmek ister misiniz?" diyaloğunu tetikleyip script'i **süresiz bloke edebiliyor** (diyaloğu kapatacak kimse olmadığında).

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** Gerçek kullanım sırasında (kullanıcı tarafından bildirildi) tekrar tekrar gözlemlendi; bir job'ın başarısız olup projeyi kaydedilmemiş bıraktığı, sonraki job'ın açılışının bu diyaloğa çarptığı senaryo doğrulandı.

**Etki:** Gerçek bir üretim riski — `CleanupStage` projeyi asla kapatmadığı için (kasıtlı: "gerçek silme işlemi yapılmayacaktır"), bir job başarısız olursa sonraki job süresiz asılı kalabilir.

**Mimari karar:** `AfterEffectsEngine.openProject()` artık her zaman önce `if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }` çalıştırıyor — önceki job nasıl bittiyse bitsin, her job temiz bir sayfadan başlıyor.

**Workaround:** Yukarıdaki "önce kapat" deseni — kalıcı, mimari düzeyde çözüm.

---

## 13. Render queue item'ın gerçek durumu (`RQItemStatus`) doğrudan sorgulanabilir

**Açıklama (pozitif bulgu):** After Effects'in kendi render queue item'ının `status` özelliği gerçek, sorgulanabilir bir enum değeri döndürüyor: `UNQUEUED=3014`, `NEEDS_OUTPUT=3013`, `QUEUED=3015`, `RENDERING=3016`, `WILL_CONTINUE=3012`, `USER_STOPPED=3017`, `ERR_STOPPED=3018`, `DONE=3019`.

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** `RQItemStatus` enum'unun tüm değerleri gerçek AE'den dökülüp doğrulandı; bir render'ın gerçekten `ERR_STOPPED` durumuna geçtiği (bozuk bir kaynak görüntü yüzünden) gerçek bir senaryoda gözlemlendi.

**Etki (pozitif):** Bu, "dosya büyüyor mu?" gibi dolaylı sinyallere güvenmek yerine render'ın gerçekten başarılı mı yoksa başarısız mı olduğunu **anında** bilmenin yolu.

**Mimari karar:** `check-render-status.jsx` bu durumu okuyup raporluyor; `AfterEffectsRenderEngine.waitForRenderCompletion()` her pollde önce bu durumu kontrol ediyor — `ERR_STOPPED` anında `RenderFailedError`, `DONE` anında başarı. Dosya boyutu stabilitesi yalnızca yedek sinyal.

**Workaround:** Gerekmedi — bu zaten çalışan, gerçek bir API.

---

## 14. Genel prensip: DoScript hata dialogları ekranda kalıp sonraki çağrıları bloke edebilir

**Açıklama:** Bir JSX script'i yakalanmamış bir hatayla başarısız olduğunda, After Effects gerçek bir hata diyaloğu gösteriyor. Bu diyalog kapatılmadan bırakılırsa, aynı AE oturumundaki **sonraki, tamamen ilgisiz** script çağrıları da bloke olabiliyor ya da tutarsız/beklenmedik şekilde başarısız olabiliyor.

**Etkilenen sürümler:** After Effects 2026 (26.3.0).

**Nasıl doğrulandı:** Bu oturumda birkaç kez doğrudan gözlemlendi — bir önceki, hatalı bir test çağrısından kalan diyalog, sonraki tamamen farklı bir test çağrısının "null is not an object" gibi ilgisiz görünen hatalar vermesine yol açtı; diyalog kapatıldığında sorun kayboldu.

**Etki:** Gerçek AE test/geliştirme sırasında, bir hata sonrası ekranın gerçekten temiz olduğunu doğrulamadan bir sonraki adıma geçmek yanıltıcı, alakasız hatalara yol açabilir.

**Mimari karar:** Üretim kodu her JSX script'ini try/catch ile sarıp gerçek hatayı rapora yazıyor (asla yakalanmamış bırakmıyor) — bu, diyalog riskini üretimde önemli ölçüde azaltıyor. Geliştirme/test sırasında ekranın gözlemlenmesi (System Events üzerinden otomatik diyalog kapatma, Accessibility izni eksikliği nedeniyle bu ortamda mümkün olmadı) hâlâ gerekli olabilir.

**Workaround:** Üretim kodunda: her script'i try/catch ile sarmak. Geliştirmede: ekranı gözlemlemek/diyalogları elle kapatmak.

---

## Özet Tablo

| #   | Konu                                      | Tür     | Kalıcı Çözüm                                                                                  |
| --- | ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| 1   | DoScript dönüş değeri gerçek değil        | Sınır   | Rapor dosyası deseni                                                                          |
| 2   | Media Encoder DoScript'i reddediyor       | Sınır   | Her zaman AE'ye script yaz                                                                    |
| 3   | `JSON` global'i yok                       | Sınır   | El yazması serileştirici                                                                      |
| 4   | `motionGraphicsTemplateController()` yok  | Sınır   | compositionName/layerName/propertyPath adresleme (bkz. scanner-manifest-metadata-contract.md) |
| 5   | `File.write()` `\r` kullanıyor            | Sınır   | Pipe (`\|`) ayracı                                                                            |
| 6   | Font doğrulama probu bozuk                | Sınır   | `app.fonts` API                                                                               |
| 7   | Output Module formatı ortam bağımlı       | Sınır   | Nihai yolu geri oku                                                                           |
| 8   | `applyTemplate()` boşluğa duyarlı         | Sınır   | Sessiz yutmayı kaldır + config                                                                |
| 9   | `queueInAME()` ayarları görmezden geliyor | Sınır   | AE'nin kendi render queue'su                                                                  |
| 10  | AME preset'leri ExtendScript'e görünmüyor | Sınır   | Yalnızca AE built-in şablonları                                                               |
| 11  | `.epr` formatı uyumsuz                    | Sınır   | (9 yeterli, gerekmedi)                                                                        |
| 12  | Kaydetmeden kapat diyaloğu riski          | Sınır   | Her zaman önce kapat                                                                          |
| 13  | `RQItemStatus` gerçek durum API'si        | Pozitif | Doğrudan kullan                                                                               |
| 14  | Ekranda kalan hata dialogları             | Genel   | try/catch + gözlem                                                                            |
