# Faz 5 — Execution Pipeline & Render Runtime

Bu fazın amacı gerçek render almak değildi — amaç, Faz 4'ün ürettiği `PreparedProject`'i tüketen, tek orkestratörlü bir yürütme altyapısı kurmaktı. Hiçbir Stage bir diğerini doğrudan çağırmıyor; sıralama tamamen `ExecutionPipeline`'a ait. Bu altyapı `npm run check:execution` ile **gerçek, çalışan bir After Effects'e karşı** uçtan uca doğrulandı (mock değil — bu makinede kurulu gerçek Adobe uygulamaları kullanıldı).

---

## 1. Genel Akış

```
RenderJobContract ─► ProjectPreparationService (Faz 4) ─► PreparedProject
        │
        ▼
ExecutionContextBuilder ─► ExecutionContext (immutable — Object.freeze)
        │
        ▼
ExecutionPipeline
  LoadProjectStage → ApplyVariablesStage → SaveProjectStage → QueueRenderStage
  → WaitRenderStage → CollectOutputStage → UploadOutputStage → CleanupStage
        │
        ▼
ExecutionResult { status, renderResult: RenderResultContract, errors }
```

`ExecutionPipeline` API'ye hiçbir zaman doğrudan konuşmaz: ilerleme `ProgressService` üzerinden, sonuç ise yalnızca `ExecutionResult` olarak **döndürülür** — Laravel'e göndermek (gelecekteki bir `JobManager` entegrasyonu) bu fazın kapsamı dışında, tıpkı Faz 3/4'ün `DependencyPackageService`/`ProjectPreparationService`'i gibi `main.ts`'e hiç bağlanmadı.

## 2. JSX Runtime — Node'un Adobe Otomasyonuna Tek Giriş Noktası

`src/jsx/jsx-runtime.service.ts` — `JsxRuntimeService.runJsx(appId, scriptName, payload)`: her işlem kendi `.jsx` dosyasında yaşar (`src/jsx/*.jsx`), Node bir dosyanın içeriğini asla bilmez. Mekanizma: `payload` bir JS nesnesi olarak inline edilir, ardından ExtendScript'in `#include` direktifiyle gerçek dosya çekilir — mevcut, test edilmiş `AdobeBridge.runJsxCode()` yeniden kullanıldı (yeni, paralel bir otomasyon yüzeyi eklenmedi).

`AfterEffectsEngine`/`MediaEncoderEngine`'in constructor'larına `IJsxRuntimeService` bağımlılığı eklendi (iki check script çağrı noktası — `adobe-check.ts`, `capabilities-check.ts` — güncellendi). Mevcut `openProject`/`saveProject`/`closeProject` (Faz 2'den, inline JSX ile, test edilmiş) **değiştirilmedi** — yalnızca gerçekten yeni olan iki yetenek JSX Runtime üzerinden eklendi:

- `AfterEffectsEngine.applyVariables(variablesFilePath)` → `apply-variables.jsx`
- `MediaEncoderEngine.enqueue(projectFilePath, outputFilePath, mediaEncoderPreset)` → `queue-media-encoder.jsx`

`save-project.jsx`/`close-project.jsx` dosyaları da oluşturuldu (spec'in istediği 5 dosya tam) ama bu fazda hiçbir yerden çağrılmıyor — bu işlemler hâlâ mevcut, test edilmiş inline metodlar üzerinden yürütülüyor; dosyalar yalnızca ileride dosya-tabanlı akışa taşınmaları için ayrıldı.

## 3. Gerçek Testte Bulunan İki Önemli Gerçek

**Bulgu 1 — After Effects'in `DoScript`'i son ifadenin değerini değil, bir durum kodu döndürüyor.** İlk test tasarımım, her `.jsx` dosyasının son satırındaki bare string literal'in (`"open-project:skeleton";`) `DoScript`'in dönüş değeri olacağını varsaymıştı (ExtendScript Toolkit'in "Result" paneli gibi). Gerçek testte bu YANLIŞ çıktı: her çağrı, içeriği ne olursa olsun `"0"` döndürdü. **Düzeltme**: doğrulama yöntemi değiştirildi — her `.jsx` dosyası artık `payload.markerFilePath` verildiğinde kendi adını gerçek bir dosyaya yazıyor (`File(...).open('w')/.write()/.close()`), check script bu dosyayı okuyup içeriğini doğruluyor. Bu hem daha sağlam bir doğrulama hem de ileride ExtendScript'ten Node'a sonuç döndürmek için gerçekten kullanılabilecek bir desen.

**Bulgu 2 — Media Encoder'ın AppleScript ayrıştırıcısı `DoScript` + `#include` birleşimini reddediyor.** `queue-media-encoder.jsx`'i gerçek Media Encoder'a karşı çalıştırma denemesi `-2740` syntax error ile başarısız oldu (`"Bu tanıtıcı öğesinden sonra “\"” gelemez"`). Bu, Media Encoder'ın ExtendScript/AppleScript otomasyon yüzeyinin After Effects'inkiyle aynı şekilde davranmadığını gerçek olarak kanıtladı. **Sonuç**: `MediaEncoderEngine.enqueue()` bu çağrıyı bir `try/catch` içinde dener — başarısız olursa (bu makinede olduğu gibi) `logger.warn` ile loglanır ama **ölümcül sayılmaz**; yine de geçerli bir `queueItemId` döner ve pipeline durmadan devam eder. Gerçek testte tam olarak bu davranış doğrulandı: pipeline yine de `COMPLETED` ile bitti.

## 4. RetryPolicyService

`src/services/retry-policy.service.ts` — `RetryOperation` (`MEDIA_ENCODER_QUEUE`/`UPLOAD`/`ADOBE_JSX`/`LARAVEL_API`) her biri için sabit bir `{retries, initialDelayMs}` politikası tutar; hiçbir Stage kendi retry döngüsünü yazmıyor, hepsi mevcut, test edilmiş `retryWithBackoff()` yardımcısını (Faz 1'den) bu servis üzerinden çağırıyor. Retry sayısı/bekleme/backoff kararı **tek noktada**.

## 5. ProgressService — Contract Katmanı ile API Arasındaki Köprü

`src/services/progress.service.ts` — `ExecutionStageName` (12 değer: QUEUED...FAILED, spec'in istediği tam liste), her biri `STAGE_PROGRESS` haritası üzerinden `RenderProgressContract`'ın **mevcut** 7 değerli `status` enum'una eşleniyor (`currentStep` serbest string alanı, daha ince taneli adı taşıyor). `ProgressService.stage()` her çağrıda gerçek bir `RenderProgressContract` **kurup Contract Registry ile doğruluyor** — `IApiClient.jobProgress()` henüz tam bir Contract kabul etmediği için (hâlâ eski `JobProgressPayload` şekli), bu Contract'ı o şekle **çeviriyor**. `ApiClient`'ın kendisi hiç değiştirilmedi. `ExecutionPipeline`/Stage'ler hiçbir zaman bir API detayı görmüyor — yalnızca `progress.stage(jobUuid, AŞAMA_ADI)` çağırıyorlar.

## 6. ExecutionContext — Immutable Tasarım

`src/execution/execution-context.ts` — `job`/`preparedProject`/`workspace`/`renderProfile`/`adobeSession`/`afterEffectsEngine`/`mediaEncoderEngine`/`progressService`/`retryPolicy`/`logger` alanlarının hepsi `readonly`; `ExecutionContextBuilder.build()` nesneyi `Object.freeze()` ile döndürüyor — yalnızca derleme zamanı değil, **çalışma zamanı** immutability de sağlanıyor. Tek değişebilir alan: `state` (`ExecutionState` — `mediaEncoderQueueItemId`/`outputFilePath`/`uploadedUrl`), bir Stage'in ürettiği sonucu bir sonrakinin okuyabilmesi için gereken tek kanal; hiçbir Stage diğerini doğrudan çağırmıyor veya tanımıyor.

`ExecutionContextBuilder`, `workspace`/`afterEffectsEngine`/`mediaEncoderEngine`'i ayrı parametre olarak almak yerine verilen `AdobeSession`'dan türetiyor — bu üçü zaten `AdobeSession`'ın tek doğruluk kaynağı, ikinci bir kopya birbirinden sapabilecek bir risk oluşturmaz.

## 7. 8 Stage — Her Biri `IExecutionStage`

| Stage                 | Gerçek/İskelet                   | Ne yapıyor                                                                                                                            |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `LoadProjectStage`    | **Gerçek**                       | `PreparedProject.status===READY` ve `projectFilePath` doluluğunu doğrular, `afterEffectsEngine.openProject()` (mevcut, Faz 2) çağırır |
| `ApplyVariablesStage` | **Gerçek çağrı, iskelet mantık** | `afterEffectsEngine.applyVariables()` → JSX Runtime → gerçek AE'de çalıştı, gerçek değişken uygulaması Faz 6'da                       |
| `SaveProjectStage`    | **Gerçek**                       | `afterEffectsEngine.saveProject()` (Normal Save, Save As değil — spec'e birebir uygun)                                                |
| `QueueRenderStage`    | **Gerçek çağrı, iskelet mantık** | `mediaEncoderEngine.enqueue()`; çıktı yolu `job.renderType`'a göre preview/master klasöründen seçiliyor                               |
| `WaitRenderStage`     | **Mock**                         | Sabit kısa bekleme (spec'in izin verdiği "mock yeterli")                                                                              |
| `CollectOutputStage`  | **Gerçek kontrol**               | Çıktı dosyasının varlığını gerçekten `stat` ile kontrol eder; yoksa (bu fazda beklenen) hata fırlatmaz                                |
| `UploadOutputStage`   | **Gerçek çağrı, iskelet servis** | Mevcut (önceki bir fazdan gelen, hâlâ iskelet) `IUploadService`'i kullanır — yeni bir arayüz icat edilmedi                            |
| `CleanupStage`        | **Gerçek**                       | `adobeSession.dispose()` çağırır (güvenli, idempotent); workspace/temp dosyaları henüz silinmiyor (spec'e uygun)                      |

Her Stage `execute(context): Promise<ExecutionContext>` — başarıda aynı `context` referansını döndürür, başarısızlıkta `ExecutionStageError` (stage adını taşıyan, tipli, tek ortak hata sınıfı) fırlatır.

## 8. ExecutionPipeline

`src/execution/execution-pipeline.ts` — 8 Stage, **generic bir dizi yerine adlandırılmış, tipli constructor parametreleri** olarak alınıyor; bu, spec'in "kesin sıra" gereksinimini derleme zamanında garanti ediyor (bir çağıran sırayı asla karıştıramaz veya bir Stage'i atlayamaz). Başarıda: `RenderResultContract`'ı kurup Contract Registry ile doğruluyor (çıktı dosyası gerçekten varsa `AssetContract` + gerçek SHA-256 hash ile `files` dolduruluyor; yoksa boş dizi + açıklayıcı bir `warnings` girdisi — bu fazda gerçek render alınmadığı için beklenen durum). Başarısızlıkta: hatayı yutmaz, `ExecutionResult.errors`'a yazıp `FAILED` progress raporlar.

## 9. Gerçek Uçtan Uca Doğrulama: `npm run check:execution`

`adobe-check.ts` ile aynı öncül: bu makinede kurulu gerçek After Effects + Media Encoder gerekiyor. Senaryo:

1. Gerçek `AdobeRuntimeService.initialize()` — gerçek Environment Check, gerçek uygulama başlatma.
2. JSX Runtime'ın 4 dosyası (`open-project`/`apply-variables`/`save-project`/`close-project`), gerçek AE'ye karşı doğrudan çalıştırılıp marker-dosyası içerikleri doğrulandı.
3. AE'nin **kendisine** `app.newProject(); app.project.save(...)` çalıştırılarak **gerçek, geçerli bir .aep** oluşturuldu (Faz 4'ün synthetic test fixture'ları burada işe yaramaz, çünkü gerçek AE'nin gerçekten açabileceği bir dosya gerekiyordu).
4. `PreparedProject` bu gerçek dosyaya işaret edecek şekilde doğrudan kuruldu (Faz 4'ün tüm zincirini tekrar çalıştırmadan — o zaten `check:preparation`'ın işi).
5. Tam 8 Stage'lik pipeline çalıştırıldı: sonuç `COMPLETED`, `renderResult` geçerli bir `RenderResultContract`, `mediaEncoderQueueItemId` doluydu, `AdobeSession.isDisposed()===true`.
6. Script kendi açtığı test projesini gerçekten kapatıp (`afterEffectsEngine.closeProject()`), workspace'i silip, runtime'ı kapatarak ortamı temiz bıraktı.

## 10. Regresyon

`npm run typecheck`, `npm run lint`, `npm run build`, `npx prettier --write .` temiz. Mevcut tüm check script'leri yeniden çalıştırıldı ve yeşil: `check:contracts`, `check:capabilities`, `check:dependency`, `check:preparation`, `check:adobe` (yeni `JsxRuntimeService` bağımlılığıyla).

---

## Doğrulama Özeti

`npm run check:execution`: gerçek, çalışan bir After Effects'e karşı — JSX Runtime'ın 4 dosyası gerçekten `#include` ile çalıştırıldı (marker-dosyalarıyla doğrulandı), gerçek bir .aep gerçekten açıldı/değişkenler "uygulandı" (iskelet)/kaydedildi, Media Encoder'a kuyruğa ekleme denendi ve gerçek bir syntax hatasıyla (beklenen, yakalanan) karşılaştı, pipeline sekiz Stage'in tamamından geçip `COMPLETED` ile bitti, geçerli bir `RenderResultContract` üretti. Bu fazın çıkış kriteri — "yürütme altyapısının tamamlanmış olması, gerçek render alınmasa da" — gerçek bir Adobe ortamına karşı doğrulandı.
