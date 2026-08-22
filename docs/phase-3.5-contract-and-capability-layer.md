# Faz 3.5 — Platform Contract Layer, Contract Registry & Capability Registry

Render özelliği eklenmedi, mevcut hiçbir servis değiştirilmedi (Adobe/Laravel/Queue/Scanner/Dependency Package kodu dokunulmadan bırakıldı). Bu faz yalnızca `src/contracts/` ve `src/capabilities/` altında yeni, bağımsız bir katman ekledi.

---

## 1. Oluşturulan Contract Klasörü

```
src/contracts/
  contract-envelope.ts        — ContractSchemaName enum + ContractEnvelope<T> taban tipi + factory
  contract-version.ts         — semver uyumluluk yardımcıları
  *.contract.ts (17 dosya)    — her biri: tip + enum + factory + Serializer + Validator
  registry/
    contract-name.ts          — Registry anahtarları (ContractName enum)
    contract-registry.types.ts — ContractStatus enum + ContractRegistryEntry tipi
    contract-serializer.ts    — ContractSerializer arayüzü + JsonContractSerializer taban sınıfı
    contract-validator.ts     — ContractValidator arayüzü + BaseContractValidator taban sınıfı
    contract-registry.ts      — ContractRegistry sınıfı
    default-contract-registry.ts — 17 Contract'ı Registry'ye kaydeden tek bootstrap noktası
  index.ts                    — barrel + PlatformContract discriminated union
```

Her `.contract.ts` dosyası **kendi kendine yeterlidir**: tip tanımı, o Contract'a özel enum'lar, `create*Contract()` factory'si, `*Serializer` ve `*Validator` sınıfları aynı dosyada — tek bir Contract'ı anlamak/değiştirmek için tek dosyaya bakmak yeterli (yüksek uyum/cohesion).

## 2. Her Contract'ın Amacı

| Contract              | Amaç                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest**          | Scanner'ın **tek** çıktı şekli — `schemaVersion`, `scannerVersion`, `engine`, `variables` (TemplateVariableContract[]), `metadata` |
| **Template Variable** | Manifest içindeki her Essential Graphics değişkeninin tanımı (key/label/type/defaultValue/sortOrder/metadata)                      |
| **Scanner Result**    | Bir tarama işleminin dış zarfı: `success`, `manifest` (başarılıysa), `errors`, `durationMs`                                        |
| **Dependency**        | Dependency Package'ın **tek** okunma şekli: fonts/plugins/presets/scripts/**licenses**                                             |
| **Asset**             | Sistemdeki **her dosya** (font, preset, render çıktısı, proje dosyası) için tek model: uuid/hash/size/type/downloadUrl/cacheKey    |
| **Render Profile**    | Preview/Master/Vertical/Square/ProRes/Alpha — hepsi aynı şekil                                                                     |
| **Render Job**        | Render Queue'nun okuduğu **tek** iş modeli                                                                                         |
| **Render Result**     | Tamamlanan render'ın **tek** dönüş şekli — `files` alanı Asset Contract'ı yeniden kullanır                                         |
| **Render Progress**   | Render sırasında gönderilen **tek** ilerleme modeli                                                                                |
| **Render Node**       | Bir node'un kimlik/versiyon bilgisi (dinamik metrikler değil — bkz. Job Heartbeat)                                                 |
| **System Status**     | Render Node'un Laravel'e gönderdiği genel durum: READY/NOT_READY/BUSY/OFFLINE/ERROR                                                |
| **Adobe Environment** | Environment Check sonucu — `status` alanı System Status ile aynı enum'u paylaşır                                                   |
| **Workspace**         | Job Workspace path'lerinin **tek** üretim şekli                                                                                    |
| **Job Lease**         | Render Farm kira sistemi: leaseId/leaseExpireAt/renewInterval/retryCount                                                           |
| **Job Claim**         | Bir job'un sahiplenilme anı — job + lease birlikte                                                                                 |
| **Job Heartbeat**     | Sadece **dinamik** metrikler (uptime, memory, runningJobs) — kimlik bilgisi burada YOK                                             |
| **Capability Report** | Bir node'un **statik yetenekleri** — ilk açılışta / değişiklikte gönderilir, heartbeat'te değil                                    |

## 3. Hangi Servisler Hangi Contract'ı Kullanacak

| Servis                                  | Kullandığı Contract'lar                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scanner (gelecek)                       | Manifest, Template Variable, Scanner Result                                                                        |
| Dependency Package akışı                | Dependency, Asset                                                                                                  |
| Render Queue / JobManager               | Render Job, Render Result, Render Progress, Job Claim, Job Lease                                                   |
| Adobe Runtime / Environment Check       | Adobe Environment, Workspace                                                                                       |
| Render Node yaşam döngüsü               | Render Node, System Status, Job Heartbeat                                                                          |
| Capability Registry                     | Capability Report (+ Render Profile, Asset dolaylı)                                                                |
| Laravel (gelecekte PHP eşdeğerleri ile) | Hepsi — bu faz TypeScript tarafını hazırladı, Laravel'in aynı JSON şeklini üreten PHP DTO'ları gelecekte eklenmeli |

## 4. Enum Yapıları

Tüm durum/kod alanları `const object + type` deseniyle (native TS `enum` değil — projenin mevcut konvansiyonu): `ContractSchemaName`, `ContractStatus`, `AssetType`, `RenderJobPriority`, `RenderJobRenderType`, `RenderProgressStatus`, `SystemStatusCode` (READY/NOT_READY/BUSY/OFFLINE/ERROR), `RenderProfileCode` (preview/master/vertical/square/prores/alpha), `SupportedFormat`, `PluginLicenseStatus`. Hiçbir yerde ham string kullanılmadı — her karşılaştırma `Object.values(Enum).includes(...)` ile yapılıyor.

## 5. Schema Version Sistemi

Her Contract `{ schema, version, createdAt }` zarfını taşır (`createContractEnvelope()` — tek üretim noktası). **Her Contract'ın versiyonu bağımsızdır**: Manifest 2.0.0'a çıksa bile Render Job 1.0.0'da kalabilir. `ContractRegistry`, her Contract için `currentVersion` + `supportedVersions[]` tutar; `isSupported(name, version)` ile bir gelen payload'ın hâlâ işlenebilir olup olmadığı kontrol edilir.

## 6. Geriye Dönük Uyumluluk Stratejisi

`contract-version.ts`'deki `isContractVersionCompatible()` semver **major** karşılaştırması yapar: `1.x` ↔ `1.y` uyumlu, `1.x` ↔ `2.y` uyumsuz. Senaryo: Manifest v2 çıktığında `supportedVersions: ['1.0.0', '2.0.0']` olarak Registry'ye eklenir — eski template'lerin v1 manifest'i hâlâ `isSupported()` ile geçerli sayılır, **yeniden taranmadan** çalışmaya devam eder. Sadece major bump (örn. zorunlu bir alan kaldırma/tip değiştirme) desteği düşürür; minor/patch her zaman geriye uyumlu kabul edilir.

## 7. Yeni Contract Ekleme Yöntemi

1. `src/contracts/yeni-isim.contract.ts` oluştur: tip + factory + Serializer + Validator (mevcut 17 dosyadan biri şablon).
2. `ContractSchemaName` ve `ContractName`'e birer sabit ekle.
3. `default-contract-registry.ts`'e **tek** `registry.register({...})` çağrısı ekle.
4. `index.ts`'e export + `PlatformContract` union'a ekle.

Başka **hiçbir** dosya değişmez — Open/Closed Principle doğrudan bu adımlarla sağlanıyor.

## 8. Contract Registry Mimarisi (serializer/validator)

`ContractRegistry` singleton DEĞİL — `createDefaultContractRegistry()` her çağrıldığında yeni bir instance döner, çağıran taraf constructor injection ile dağıtır (projenin "singleton yok" kuralına uygun).

- **Serializer**: `JsonContractSerializer<T>` taban sınıfı JSON.stringify/parse'ı tek yerde yapar; `ManifestSerializer` gibi 17 isimli alt sınıf sadece `extends` eder — kod tekrarı yok, ama her Contract'ın kendi tipli Serializer'ı var.
- **Validator**: `BaseContractValidator<T>` zarfı (schema/version/createdAt) doğrular; her `XxxValidator` sadece kendi alanlarına özel `validatePayload()`'ı override eder. Hatalar `ContractValidationError` ile (hangi alan, neden) fırlatılır.
- **Registry API** (spec'teki 6 metod, hepsi test edildi): `getContract(name)`, `getCurrentVersion(name)`, `isSupported(name, version)`, `getSchema(name)`, `validate(name, object)`, `listContracts()`.

## 9. Platformun Servisler Arası Veri Akışı

```
Scanner ──ManifestContract──► Laravel ──DependencyContract──► Render Node
                                  │
Render Node ──SystemStatusContract / JobHeartbeatContract / CapabilityReportContract──► Laravel
                                  │
Laravel ──RenderJobContract──► Render Node ──JobClaimContract──► Laravel
                                  │
Render Node ──RenderProgressContract (sırasında) / RenderResultContract (sonunda)──► Laravel
```

Her ok, karşılıklı iki ucun da AYNI Contract'ı (aynı `schema`/`version`) beklediği bir sözleşmedir — hangi taraf önce/sonra deploy edilirse edilsin, `isSupported()` kontrolü sayesinde uyumsuz bir versiyon sessizce kabul edilmez.

---

## 10. Capability Registry Mimarisi

`src/capabilities/` — Contract Registry'den **bağımsız çalışmaz**: `CapabilityRegistry.collect()` raporun versiyonunu asla hardcode etmez, her seferinde `contractRegistry.getCurrentVersion(ContractName.CAPABILITY_REPORT)` çağırır. `CapabilityRegistry` de singleton değil, `CapabilityRegistryDependencies` nesnesiyle constructor injection alır.

## 11. Provider Yapısı

Her bileşen kendi `ICapabilityProvider<T>`'ını implemente eder (`collect(): Promise<T>`), Open/Closed'a birebir uyar — yeni bir Engine (DaVinci, Blender...) eklemek yeni bir provider eklemek demektir, mevcut hiçbiri değişmez:

| Provider                            | Gerçek mi, iskelet mi | Kaynak                                                                                                                                                            |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdobeCapabilityProvider`           | **Gerçek**            | Mevcut `IAfterEffectsEngine`/`IMediaEncoderEngine`'i **salt okunur** kullanır (Adobe kodu değişmedi)                                                              |
| `HardwareCapabilityProvider`        | **Gerçek**            | CPU/RAM: `os` modülü; GPU: `system_profiler`, Disk: `df` (timeout'lu, hatada `null`)                                                                              |
| `FontCapabilityProvider`            | **Gerçek**            | Dependency Package'ın önbellek dosyasını **salt okur**, SHA-256 hash'ini `fontPackageVersion` olarak döner — dosya tek tek değil, versiyon/hash olarak raporlanır |
| `PluginCapabilityProvider`          | **Dürüst iskelet**    | Gerçek plugin taraması için güvenilir bir API yok; boş liste döner (icat edilmiş veri yok)                                                                        |
| `RenderProfileCapabilityProvider`   | **Gerçek**            | Mevcut `RenderProfileRegistry`'yi salt okur, sadece **gerçekten aktif** profilleri (şu an preview+master) bildirir                                                |
| `OperatingSystemCapabilityProvider` | **Gerçek**            | `os` modülü                                                                                                                                                       |

## 12. Capability Veri Modeli

`CapabilityReportContract` (contracts/ altında, spec'in "Capability modelleri Contract katmanındaki veri modellerini kullanacaktır" kuralına uygun): node identity, adobe (versiyon + dynamic link), supportedEngines, supportedRenderProfiles, **fontPackageVersion** (tek hash, dosya listesi değil), installedPlugins, supportedFormats, hardware, performance.

**Gerçek test sırasında bulunan ve düzeltilen hata:** İlk çalıştırmada `compare()`, donanımın TÜM alanlarını (disk boş alanı dahil) karşılaştırıyordu — disk boş alanı canlı bir sistemde saniyeler içinde doğal olarak değiştiği için, aynı sistem durumunda bile "değişti" diye işaretliyordu. Bu, spec'in "yalnızca gerçekten değiştiğinde tekrar gönder" ilkesini bozardı. Düzeltme: `compare()` artık donanımı yalnızca **kararlı kimlik alanlarına** (cpuModel/cpuCores/gpuModel) göre karşılaştırıyor; disk/RAM sayıları bilgi amaçlı kalıyor ama "değişti" sinyali tetiklemiyor. İki ayrı gerçek toplama ile (`register()` + `update()`) `changed: false` olarak doğrulandı.

## 13. Laravel Scheduler ile Entegrasyon

`CapabilityRegistry.supports(report, requirement)` ve `findBestNode(reports, requirement)` saf fonksiyonlardır (girdi olarak `CapabilityReportContract[]` alırlar) — bu, Laravel'in (veya merkezi bir scheduler'ın) elindeki TÜM node raporlarını toplayıp aynı algoritmayı çalıştırabileceği anlamına gelir. Spec'teki akış birebir `supports()` içinde uygulanıyor: engine uygunluğu → render profile desteği → font paket versiyonu → plugin uyumluluğu → **node boş mu** (`currentRunningJobs < maxConcurrentJobs`). `findBestNode()`, uygun adaylar arasından en düşük yük oranına (`currentRunningJobs / maxConcurrentJobs`) sahip olanı seçer — gerçek testte (3/4 yüklü vs 0/4 boş node) doğru node'u seçtiği doğrulandı.

## 14. Render Node Entegrasyonu

Bu faz `main.ts`/`JobManager`'a **hiç bağlanmadı** (spec'in "hiçbir mevcut servis değiştirilmeyecek" kuralı). Doğrulama, `adobe-check.ts`/`dependency-check.ts` presedentiyle aynı şekilde iki bağımsız script ile yapıldı: `npm run check:contracts` (17 Contract'ın oluşturulup doğrulanıp serialize/deserialize edilmesi + bir negatif senaryo) ve `npm run check:capabilities` (gerçek CPU/RAM/GPU/disk + gerçek Adobe/RenderProfile verisiyle tam bir Capability Report toplanması, register/update/compare/supports/findBestNode).

## 15. Gelecekte Yeni Engine Ekleme Yöntemi

1. Yeni bir `XxxCapabilityProvider` yaz (`ICapabilityProvider<T>` implement et).
2. `CapabilityRegistryProviders` arayüzüne yeni alanı ekle.
3. `CapabilityRegistry.collect()`'teki `Promise.all` listesine ekle.
4. `supportedEngines`/`supportedFormats` listesine yeni değerleri ekle.

Mevcut 6 provider'dan hiçbiri değişmez.

## 16. İş Dağıtım Algoritmasına Katkısı

Spec'teki "Hiçbir zaman rastgele Node seçilmeyecektir" ilkesi artık somut kod: `findBestNode()` olmadan (veya rastgele seçimle) job dağıtımı yapmak, bu faz sayesinde artık mimari olarak "yanlış" — doğru yol her zaman `supports()` + `findBestNode()` üzerinden geçmek. Gelecekteki Laravel scheduler'ı (veya merkezi bir Job Broker), toplanan `CapabilityReportContract[]`'ı bu iki metoda vererek karar verecek; algoritmanın kendisi (kriter sırası, yük dengeleme mantığı) TEK bir yerde (`CapabilityRegistry`) yaşadığı için ileride değiştirilmesi de tek noktadan olacak.

---

## Doğrulama

`npm run typecheck`, `npm run lint`, `npm run build` temiz. `npm run check:contracts`: 17/17 Contract oluşturuldu, doğrulandı, serialize/deserialize round-trip'i geçti; kasıtlı bozuk bir Manifest doğru şekilde reddedildi; versiyon uyumluluğu (`1.2.0`↔`1.0.0` uyumlu, `2.0.0`↔`1.0.0` uyumsuz) doğrulandı. `npm run check:capabilities`: gerçek donanım/Adobe/RenderProfile verisiyle tam bir rapor toplandı; iki ayrı gerçek toplama arasında sahte "değişti" sinyali vermediği (düzeltmeden sonra) doğrulandı; `supports()`/`findBestNode()` doğru sonuç verdi.
