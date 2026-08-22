# Faz 7 — Laravel Integration, Job Broker API & Production Orchestration

Bu fazın amacı yeni bir render özelliği değildi — Faz 1–6 boyunca kurulan tüm mimariyi (Contract Layer, Capability Registry, Adobe Runtime, Dependency Package, Project Preparation, Execution Pipeline, Render Broker/Scheduler) **ilk kez gerçek bir Laravel-şekilli backend ile uçtan uca bağlamaktı**. Hiçbir mevcut servis yeniden yazılmadı — bu faz yalnızca `src/api/` ve `src/orchestrator/` altında yeni bir **Production Orchestrator** katmanı ekledi ve `main.ts`'i bu katmanı kullanacak şekilde yeniden bağladı.

pratiktools-site'ın Cloud Rendering rotaları henüz gerçekten yazılmadığı için (bu proje boyunca sürekli doğrulanan bir gerçek), `npm run check:orchestrator` **gerçek bir yerel HTTP sunucusu** (Node'un yerleşik `http` modülü, yeni bağımlılık yok) kurup bu fazın spesifikasyonundaki tüm endpoint'leri gerçek olarak uygulayarak tüm akışı baştan sona doğruladı — mock değil, gerçek istek/yanıt, gerçek auth header kontrolü, gerçek dosya indirme.

---

## 1. Genel Kurallara Uyum

Faz 1–6'nın hiçbir servisi (Contract Registry, Capability Registry, Adobe Runtime, Dependency Package, Project Preparation, Execution Pipeline, Render Broker/Scheduler) değiştirilmedi. Tek katkısal (additive, davranışı bozmayan) istisnalar:

- `RetryPolicyService`'e Faz 6'da zaten eklenmiş olan `JOB_SCHEDULING` operasyonu — bu faz `LARAVEL_API` operasyonunu (Faz 5'ten, zaten var olan) kullandı, yeni bir şey eklemedi.
- `services/progress.service.ts`'de yalnızca `STAGE_PROGRESS` sabiti `export` edildi (davranış değişmedi) — `ProgressForwarder`'ın aynı eşleme tablosunu tekrar yazmadan kullanabilmesi için.
- `services/health.service.ts` — Faz 1'den beri **kasıtlı olarak boş bırakılmış bir iskelet** ("Intentionally does nothing yet — not wired into main.ts") tam olarak bunun için, bu fazda gerçek implementasyonla dolduruldu. Hiçbir çağıran nokta yoktu, dolayısıyla hiçbir şey bozulmadı.

## 2. AuthService + LaravelApiClient — Gerçek HTTP, Mock Değil

`src/api/auth.service.ts` — `POST /auth/login`'e gerçek bir `fetch` çağrısı yapar, token'ı süresiyle birlikte önbelleğe alır, süresi dolmadan (30 saniyelik güvenlik payı ile) yeniden login olur. Hiçbir başka servis token üretmez veya saklamaz.

`src/api/laravel-api.client.ts` — Faz 1'in mock `ApiClient`'ının **ilk gerçek muadili**: her metod gerçek bir `fetch` çağrısı, `AuthService` üzerinden kimlik doğrulanmış, `RetryPolicyService` (`RetryOperation.LARAVEL_API`) ile retry'lı. Mevcut `IApiClient`'ı **değiştirmeden** uygular (bu yüzden `AdobeRuntimeService` gibi mevcut tüketicilere doğrudan enjekte edilebilir) ve üstüne spec'in istediği yeni, Contract-tabanlı metodları ekler (`registerNode`, `sendJobHeartbeat`, `claimNextJob`, `sendJobProgress`, `sendJobCompleted`, `sendJobFailed`, `downloadAsset`). Eski mock `ApiClient` hiç dokunulmadan kaldı — hâlâ her check script'in kullandığı şey.

**Tasarım kararı — `/jobs/{jobUuid}/claim` neden tek bir `claimNextJob()` çağrısına dönüştü**: `JobClaimContract` yalnızca `jobUuid`/`nodeUuid`/`claimedAt`/`lease` taşır, iş detaylarını (templateUuid, variables) taşımaz — ve Contract'lar bu fazda değiştirilemez. Bu yüzden `claimNextJob()` tek bir çağrıda hem `RenderJobContract` hem `JobClaimContract`'ı birlikte döndürüyor; ikinci bir round-trip'e gerek kalmadan.

## 3. HealthService — Artık Gerçek

7 kontrolün hepsi gerçek, salt-okunur sorgular: Adobe Runtime hazır mı (`isReady()`), AE/ME erişilebilir mi (`isRunning()`), workspace erişilebilir mi (gerçek `stat`), disk alanı yeterli mi (mevcut `HardwareCapabilityProvider`'ı yeniden kullanır), font paketi erişilebilir mi (mevcut `FontCapabilityProvider`'ı yeniden kullanır), dependency cache erişilebilir mi. Hiçbiri bir uygulama başlatmaz, dosya yazmaz veya herhangi bir state'i değiştirmez.

## 4. Production Orchestrator — `src/orchestrator/`

| Dosya                          | Rolü                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-registration.service.ts` | Node Lifecycle'ın ilk 4 adımı: Environment Check → Adobe Runtime `initialize()` → Capability `collect()` → Laravel `registerNode()` — hepsi mevcut, dokunulmamış servisler üzerinden                                 |
| `heartbeat-loop.ts`            | Tamamen bağımsız async loop (JobPoller'ın İÇİNDE çalışmaz) — yalnızca `JobHeartbeatContract` gönderir, capability asla heartbeat ile gitmez                                                                          |
| `capability-loop.ts`           | Kendi zamanlamasında çalışır, yalnızca `CapabilityRegistry.compare()` gerçek bir değişiklik raporladığında yeniden gönderir                                                                                          |
| `progress-forwarder.ts`        | Faz 5'in `IProgressService`'inin **gerçek** implementasyonu — Execution Pipeline/Stage'ler `progress.stage(...)` çağırmaya devam eder, farkı hiç bilmez; gerçek `RenderProgressContract`'ı doğrudan Laravel'e iletir |
| `result-forwarder.ts`          | `ExecutionResult` → `RenderResultContract` (COMPLETED) veya `sendJobFailed` (FAILED)                                                                                                                                 |
| `job-poller.ts`                | Gerçek akış: `claimNextJob()` → gerçek asset/dependency indirme → `ProjectPreparationService.prepare()` → `ExecutionPipeline.run()` → `ResultForwarder.send()`                                                       |
| `node-runner.ts`               | Tek giriş noktası — Node Lifecycle'ı sırayla çalıştırır, sağlık kontrolü döngüsünü ve zarif kapanışı yönetir                                                                                                         |

## 5. JobPoller — Gerçek İndirme + Boş Dependency Package Düşüşü

`ProjectPreparationService`/`DependencyPackageService` (Faz 4/3, dokunulmadı) her zaman **yerel bir dosya yolu** bekler — gerçek HTTP indirmesi bu fazdan önce hiç yoktu. `JobPoller`, `LaravelApiClient.downloadAsset()` ile gerçek bayt indirir; bir template'in dependency package'ı yoksa (`getDependencyPackage()` null döner), gerçek ama boş bir `dependencies.json` içeren bir zip'i yerel olarak inşa eder (`buildEmptyDependencyPackage()`) — Phase 3'ün kendi spec'i zaten "boş paket geçerlidir" diyor, burada hiçbir veri icat edilmedi, yalnızca şekil sağlandı.

## 6. Gerçek Testte Bulunan ve Düzeltilen Bir Tasarım Hatası

İlk taslakta `tick()` bir iş claim ettikten sonra `processJob()` İÇİNDE **`claimNextJob()` ikinci kez** çağrılıyordu (gereksiz bir "gelecekte API farklı olursa" savunması yüzünden) — bu, `POST /jobs/claim`'in **atomik olarak bir sonraki işi claim ettiği** gerçek semantiğiyle çelişiyordu: ikinci çağrı yanlışlıkla **farklı bir ikinci işi** claim ederdi. Kod yazılırken (henüz test edilmeden) fark edilip düzeltildi: `tick()` artık claim edilen `RenderJobContract`'ı doğrudan `processJob()`'a geçiriyor, ikinci bir ağ çağrısı yapmıyor.

Ayrıca `CapabilityRegistry.getPerformance()` ile `JobPoller.getRunningJobCount()` arasında gerçek bir dairesel bağımlılık vardı (biri diğerini constructor'da istiyor) — açıkça tipli, değiştirilebilir bir getter referansıyla (`let getRunningJobCount: () => number`) çözüldü, iki nesne arasında dairesel bir referans olmadan.

## 7. Node Kimliği — Kendi Kendine Üretilen UUID

`CapabilityReportContract.nodeUuid` zorunlu bir alan ve Capability toplama, Laravel'e kayıttan ÖNCE gerçekleşiyor (Node Lifecycle: "Capability Registry collect() ↓ Laravel registerNode()") — yani node, Laravel bir UUID atamadan ÖNCE kendi kimliğini bilmek zorunda. `main.ts`/`orchestrator-check.ts` bu yüzden `randomUUID()` ile kendi kimliğini baştan üretiyor (Faz 1'in mock `register()` akışının da her seferinde taze bir UUID ürettiği gibi — kalıcılık henüz yok, gelecekte eklenebilir makul bir geliştirme).

## 8. Gerçek Uçtan Uca Doğrulama: `npm run check:orchestrator`

`src/orchestrator-check.ts`, gerçek bir Node.js `http.Server` ile şu endpoint'lerin **hepsini** gerçek olarak uyguluyor: `/auth/login`, `/nodes/register`, `/nodes/heartbeat`, `/jobs/claim`, `/jobs/{uuid}/progress`, `/jobs/{uuid}/completed`, `/jobs/{uuid}/failed`, artı eski mock'un `getTemplateAsset`/`getDependencyPackage`/`reportSystemStatus` rotaları ve gerçek dosya indirme uç noktaları. Gerçek After Effects'e kendi gerçek, geçerli bir `.aep` oluşturtup (Faz 5'teki `execution-check.ts` ile aynı yöntem), bunu iç içe bir arşive paketleyip bu sahte sunucudan **gerçekten indirtiyor**.

Tek çalıştırmada (2 kez tekrarlanıp doğrulandı) gerçekleşenler:

- Gerçek login + token alma
- Gerçek Environment Check + Adobe Runtime `initialize()`
- Gerçek Capability toplama + Laravel'e kayıt
- Gerçek `JobHeartbeatContract` gönderimi
- Gerçek iş claim (sahte sunucudan)
- Gerçek template + dependency asset indirme (HTTP üzerinden gerçek baytlar)
- Gerçek Project Preparation Pipeline (extraction, manifest doğrulama, variables.json)
- Gerçek Execution Pipeline — 8 stage'in hepsi gerçek After Effects'e karşı, 9 ilerleme raporu gerçekten Laravel'e (sahte sunucuya) iletildi
- Gerçek `RenderResultContract` ile COMPLETED raporlandı
- Media Encoder JSX denemesi Faz 5'te bulunan aynı, beklenen, yakalanan hatayla başarısız oldu (ölümcül değil)
- Zarif kapanış: polling durdu → heartbeat durdu → Adobe Runtime kapandı (aktif session'lar zaten kendi içinde dispose edildi) → NOT_READY bildirildi

## 9. Regresyon

`npm run typecheck`, `npm run lint`, `npm run build`, `npx prettier --write .` temiz. Mevcut tüm check script'leri (`contracts`, `capabilities`, `dependency`, `preparation`, `scheduler`, `adobe`, `execution`) yeniden çalıştırıldı ve yeşil — bu faz hiçbirini bozmadı.

---

## Doğrulama Özeti

`npm run check:orchestrator`: gerçek bir yerel HTTP sunucusuna karşı — gerçek auth, gerçek node kaydı, gerçek capability/heartbeat, gerçek iş claim, gerçek dosya indirme, gerçek Project Preparation, gerçek After Effects'e karşı gerçek Execution Pipeline, gerçek ilerleme/sonuç iletimi ve zarif kapanış — spec'in "Faz Sonunda Beklenen Durum" akışının **tamamı**, `npm start`'ın (bu script'in mirror'ladığı gerçek `main.ts` akışı) production'da çalışacağı şekliyle, uçtan uca ve tekrarlanabilir şekilde doğrulandı.
