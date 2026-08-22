# Faz 6 — Distributed Render Broker, Scheduler & Execution Orchestrator

Bu fazın amacı gerçek render almak değildi — amaç, PratikTools Cloud Render'ı tek-node mantığından gerçek bir dağıtık (Render Farm) mimarisine taşıyan **merkezi bir Render Broker katmanı** kurmaktı. Faz 1–5'te oluşturulan hiçbir şey (Contract Layer, Capability Registry, Adobe Runtime, Dependency Package, Project Preparation, Execution Pipeline) değiştirilmedi — bu faz tamamen yeni, bağımsız bir `src/broker/` modülü ekledi.

Mimari diyagramın "Laravel içinde" gösterdiği Render Broker, gerçek bir Laravel API henüz var olmadığı için (kurulan her fazda olduğu gibi) bu repoda **TypeScript ile, gerçek ve tam çalışan bir referans implementasyonu** olarak inşa edildi — `npm run check:scheduler` en az 4 sanal Render Node ile gerçek bir simülasyon çalıştırıyor (mock değil, gerçek karar mantığı).

---

## 1. Genel Kurallara Uyum

- **Hiçbir mevcut servis yeniden yazılmadı**: `CapabilityRegistry.supports()`/`findBestNode()` dokunulmadan kaldı — Broker'ın kendi `matchesCapability()` fonksiyonu (bkz. Bölüm 3) kasıtlı olarak **bağımsız** yazıldı, çünkü `CapabilityRegistry` node-scoped bir DI grafiğine (hardware provider'lar) bağlı ve merkezi Broker'ın bunu kurmasının hiçbir anlamı yok.
- **Hiçbir mevcut API/Contract değişmedi**: `JobLeaseContract`/`JobClaimContract`/`JobHeartbeatContract` olduğu gibi kullanıldı. `RetryPolicyService`'e yalnızca **katkısal** bir `RetryOperation.JOB_SCHEDULING` değeri eklendi (mevcut 4 değer dokunulmadan).
- **Singleton yok**: her servis `new` ile constructor injection'la kuruluyor; `scheduler-check.ts` aynı bağımlılıkları paylaşan ama farklı stratejiyle birden fazla `RenderBrokerService` örneği kurarak bunu gerçek olarak test ediyor.

## 2. Job State Machine

`src/broker/job-state.types.ts` + `job-state-machine.ts` — `JobState` (12 değer: QUEUED...RETRYING) ve `VALID_JOB_STATE_TRANSITIONS` tablosu **tek doğruluk kaynağı**. `JobStateMachine.transition()` tabloyu kontrol etmeden hiçbir servisin state'i değiştirmesine izin vermiyor — `RenderBrokerService`, `ExecutionCoordinator`, `DeadJobRecoveryService`, `JobScheduler` hepsi `transition()` çağırıyor, hiçbiri state'i doğrudan set etmiyor. PAUSED/RESUMED (Bölüm 12) bilinçli olarak eklenmedi — ama tablo-tabanlı tasarım sayesinde ileride sadece yeni satırlar eklenerek (mevcut hiçbir servise dokunmadan) desteklenebilir.

## 3. Capability Eşleştirme — Bağımsız, Merkezi Bir Kopya

`src/broker/capability-match.ts` — `matchesCapability(report, requirement)`, `CapabilityRegistry.supports()`'un aynı 4 kontrolünü (engine/renderProfile/fontPackageVersion/plugins) **bağımsız olarak** uygular. Kasıtlı olarak "running jobs < max" kontrolünü İÇERMEZ — bu canlı bir gerçek olduğu için ayrı, heartbeat-kaynaklı bir kontrole (`RenderBrokerService.hasFreeCapacity()`) bırakıldı.

## 4. LeaseManager — JobLeaseContract'ın Gerçek Kullanımı

`src/broker/lease-manager.ts` — `createLease`/`renewLease`/`releaseLease`/`expireLease`/`forceRelease`. Her lease, Contract Registry'nin **o anki versiyonuyla** kurulup doğrulanıyor — hiçbir yerde versiyon hardcode edilmedi. `retryCount` alanı gerçekten kullanılıyor: her retry denemesinde artıyor (bkz. Bölüm 9).

## 5. HeartbeatWatcher

`src/broker/heartbeat-watcher.ts` — 30 saniyelik varsayılan eşik (`DEFAULT_OFFLINE_THRESHOLD_MS`), testte gerçek zaman akışını beklemek yerine daha kısa bir eşikle (300ms) parametrize edilerek gerçek, gerçek-zamanlı bir offline senaryosu test edildi (`await sleep(350)`). `findNewlyOfflineNodes()` bir node'u yalnızca BİR KEZ "yeni offline" olarak raporluyor — tekrar tekrar Dead Job Recovery tetiklemiyor.

## 6. NodeScoringService — 9 Kriter

`src/broker/node-scoring.service.ts` — spec'in listelediği 9 kriterin (Running Jobs, Max Concurrent Jobs, CPU Load, Memory Usage, Cache Match, Template Match, Font Package Match, Plugin Match, Render Profile Match) her biri **gerçek** alanlardan hesaplanıyor: hiçbiri uydurulmuş veri değil. Platformda henüz gerçek bir CPU kullanım telemetrisi olmadığı için `CPU_LOAD` dürüstçe bir proxy olarak belgelendi (çekirdek başına running job oranı). `score()` bir strateji tarafından sağlanan ağırlık vektörüyle 9 kriteri ağırlıklı ortalamaya indirger — ağırlıkları NodeScoringService değil, her strateji kendisi seçer.

## 7. Strategy Pattern — 4 Strateji

`src/broker/strategies/` — `INodeSelectionStrategy` arayüzü + `LeastLoadedStrategy`, `CacheFirstStrategy`, `TemplateAffinityStrategy`, `PriorityStrategy`. Her biri yalnızca farklı bir `ScoringWeights` vektörüyle `NodeScoringService.score()`'u çağırıyor — `PriorityStrategy` tek istisna: `RenderJobPriority`'ye göre **üç farklı** ağırlık seti arasında geçiş yapıyor (HIGH → yükü/CPU'yu ağırlıklandır, LOW → cache/template'i ağırlıklandır). Yeni bir strateji eklemek yalnızca yeni bir dosya + `RenderBrokerService`'e o stratejiyi enjekte etmek demek — mevcut hiçbir strateji veya `RenderBrokerService`'in kendisi değişmiyor (Open/Closed, gerçek testte doğrulandı — bkz. Blok 5).

## 8. RenderBrokerService — Tek Karar Verici

`src/broker/render-broker.service.ts` — spec'in listelediği her sorumluluk (uygun node seçme, capability kontrolü, lease oluşturma, retry kararı, load balancing, failover, job affinity) burada, tek bir yerde yaşıyor. Önemli bir tasarım kararı: node seçimi için aday filtresi **üç** koşulu birden gerektiriyor — `matchesCapability()` (statik uyumluluk) + `hasFreeCapacity()` (canlı, heartbeat-kaynaklı yük) + **`heartbeatWatcher.isOnline()`** (canlılık). Üçüncü koşul gerçek testte bulunan bir hatayı düzeltti (bkz. Bölüm 11).

`requirementByJob` haritası her job'ın orijinal `SchedulingRequirement`'ını saklıyor — bu sayede hem retry hem failover-sonrası yeniden zamanlama, çağrıcının gereksinimi tekrar sağlamasına gerek kalmadan otomatik çalışabiliyor.

## 9. Retry — Mevcut RetryPolicyService ile Gerçek Entegrasyon

`reportJobFailed()`: `lease.retryCount` `maxRetries`'ı aşmadıysa state RETRYING'e geçer, ardından **gerçek** `RetryPolicyService.execute(RetryOperation.JOB_SCHEDULING, ...)` çağrısı içinde yeni bir node seçilip yeni bir lease (retryCount+1 ile) oluşturulur. `maxRetries` aşıldığında job terminal CANCELLED durumuna geçer ve `null` döner — çağrıcı (gerçek sistemde JobManager) bunu "artık pes et" sinyali olarak okur.

## 10. Job Affinity, Capability Cache, Cancellation, Dead Job Recovery

- **Job Affinity** (Bölüm 10): `reportJobCompleted()`, hangi node'un hangi `templateUuid`'i işlediğini `processedTemplateUuids` setine kaydeder — `TemplateAffinityStrategy` bunu doğrudan okur.
- **Capability Cache** (Bölüm 9): `registerNode()`/`updateNodeCapability()` yalnızca gerçek bir capability değişikliğinde çağrılır; `recordHeartbeat()` yalnızca canlı, dinamik sayıları (`JobHeartbeatContract`) günceller — capability asla her heartbeat'te yeniden üretilmez.
- **Job Cancellation** (Bölüm 11): `cancelJob()`/`isCancelled()` — ayrı bir servis yerine `RenderBrokerService`'in kendi sorumluluğu (spec'in Bölüm 15 servis listesinde ayrı bir Cancellation servisi zaten yok).
- **Dead Job Recovery** (Bölüm 13): `DeadJobRecoveryService`, offline bir node'daki her job için lease'i force-release eder, state'i EXPIRED→QUEUED'a taşır. Workspace'e hiç dokunmaz ("Workspace korunur") — zaten merkezi tarafta silinecek bir şey yok, gerçek node'un kendi workspace'i (Faz 4/5) bu fazda da otomatik silinmiyor.

## 11. ExecutionCoordinator

`src/broker/execution-coordinator.ts` — CLAIMED sonrası PREPARING→EXECUTING→UPLOADING→COMPLETED geçişlerini sürer; gerçek bir sistemde bunlar node'un heartbeat/progress raporlarıyla tetiklenir, bu simülasyonda check script doğrudan çağırıyor. `completeJob()` affinity kaydını günceller, `failJob()` retry akışını tetikler — ikisi de yalnızca `JobStateMachine` üzerinden geçiş yapar.

## 12. Gerçek Testte Bulunan Hata: Offline Node'lar Aday Listesinden Çıkarılmıyordu

İlk implementasyonda `selectAndClaim()`'in aday filtresi yalnızca `matchesCapability` + `hasFreeCapacity` kontrol ediyordu — `heartbeatWatcher.isOnline()` kontrolü **eksikti**. Gerçek testte (Blok 7) bu, offline bir node'un Dead Job Recovery sonrası yeniden zamanlama sırasında **hâlâ aday olarak değerlendirilmesine** yol açtı (job'ın kendisi hâlâ o node'a claim edilebiliyordu). Düzeltme: aday filtresine `heartbeatWatcher.isOnline(node.capability.nodeUuid)` eklendi — bu, "Node çevrimdışı olduğunda hiçbir yeni job ona verilmemeli" kuralının kod düzeyinde garantisi.

İkinci, daha küçük bir zamanlama hatası da bulundu: test senaryosunda "hayatta kalan" node'un heartbeat'i offline eşiğinden ÖNCE değil SONRA gönderilmeliydi (aksi halde ikisi de aynı anda offline sayılıyordu) — düzeltildi.

## 13. Gerçek Uçtan Uca Doğrulama: `npm run check:scheduler`

`src/scheduler-check.ts`, 4 sanal Render Node (nodeA/B/D uyumlu, nodeC kasıtlı uyumsuz) ile spec'in **her** çıkış kriterini ayrı, adlandırılmış bloklarda doğruluyor:

| Blok | Doğrulanan kriter                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Capability uyumsuz node'a iş gitmiyor; uyumlu tek node/engine doğru seçiliyor; desteklenmeyen engine için `NoCapableNodeError`            |
| 2    | Node Score algoritması (3 aday arasından en boş olanı doğru seçiyor)                                                                      |
| 3    | Ardışık/eşzamanlı işler, yük değiştikçe farklı node'lara doğru dağılıyor                                                                  |
| 4    | Job Affinity: aynı template için aynı node tercih ediliyor                                                                                |
| 5    | Strategy Pattern: aynı bağımlılıklarla, yalnızca stratejisi farklı iki `RenderBrokerService` gerçekten farklı (ve doğru) kararlar veriyor |
| 6    | PriorityStrategy: HIGH en boş node'u, LOW cache-warm node'u seçiyor                                                                       |
| 7    | Node offline → lease force-release → job otomatik olarak farklı, çevrimiçi bir node'a yeniden zamanlanıyor                                |
| 8    | Retry: ilk hatada yeni lease + yeni claim; maksimum retry aşılınca terminal CANCELLED                                                     |
| 9    | Job Cancellation: state, lease, `isCancelled()` hepsi doğru                                                                               |
| 10   | State Machine geçersiz bir geçişi (`QUEUED→COMPLETED`) reddediyor                                                                         |

10 blok da, 3 ardışık çalıştırmada da **tutarlı ve deterministik** şekilde geçti.

## 14. Regresyon

`npm run typecheck`, `npm run lint`, `npm run build`, `npx prettier --write .` temiz. Mevcut tüm check script'leri yeniden çalıştırıldı ve yeşil: `check:contracts`, `check:capabilities`, `check:dependency`, `check:preparation`, `check:adobe`, `check:execution` (ikisi de gerçek After Effects/Media Encoder'a karşı) — bu faz hiçbirini bozmadı.

---

## Doğrulama Özeti

`npm run check:scheduler`: en az 4 sanal Render Node ile gerçek bir Render Broker/Scheduler simülasyonu — capability filtreleme, Node Score algoritması, çoklu-iş yük dengeleme, Job Affinity, 4 farklı Strategy Pattern implementasyonu (biri iş önceliğine göre kendi içinde de değişen), node-offline failover + Dead Job Recovery (gerçek zamanlayıcı gecikmesiyle test edildi), retry mekanizması (maksimum deneme sonrası terminal duruma geçiş dahil), Job Cancellation ve State Machine'in geçersiz geçişleri reddetmesi — spec'in 16. bölümde listelediği **her** kriter, ayrı ayrı, gerçek ve tekrarlanabilir şekilde doğrulandı.
