# Faz 4 — Project Preparation Pipeline

Bu faz, bir Render Job'ın Adobe Runtime'a verilmeden ÖNCE ihtiyaç duyduğu her şeyi (template proje dosyası, dependency package, değişken değerleri) tek, öngörülebilir bir Job Workspace'e hazırlayan yeni bir katman ekledi: `src/preparation/`. Gelecekteki bir Render Engine, bu fazın ürettiği `project.aep` + `variables.json` çiftini tüketmekten başka hiçbir hazırlık işi yapmaz. Mevcut hiçbir servis (Adobe Runtime, Dependency Package akışı, Contract/Capability Registry) yeniden yazılmadı — sadece iki Contract geriye dönük uyumlu şekilde genişletildi ve üstüne yeni bir orkestrasyon katmanı eklendi.

---

## 1. Contract Katmanındaki Genişletmeler (v1.0.0 → v1.1.0)

Spec'in "yeni JSON şekli icat edilmeyecek" kuralına uygun olarak hiçbir yeni Contract eklenmedi; bunun yerine iki mevcut Contract **katkısal (additive)** biçimde v1.1.0'a çıkarıldı, `supportedVersions`'a hem `1.0.0` hem `1.1.0` eklendi ve her iki Validator versiyon-farkında hale getirildi (yeni alanlar yalnızca payload'ın kendi `version`'ı ≥ 1.1.0 olduğunda zorunlu):

| Contract       | v1.0.0 alanları                                    | v1.1.0'da eklenen                                                                 |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Workspace**  | jobUuid/workspace/source/preview/master/cache/logs | `dependency`, `extracted`, `manifest`, `variables` (4 yeni Job Workspace klasörü) |
| **Dependency** | fonts/plugins/presets/scripts/licenses             | `luts`, `expressions`, `assets` (3 yeni bağımlılık türü)                          |

Bu, Faz 3.5'te tasarlanan geriye dönük uyumluluk mekanizmasının ilk gerçek, üretimde kullanılan örneğidir: `default-contract-registry.ts`'de her iki Contract'ın `supportedVersions` dizisi `[X_CONTRACT_VERSION]` yerine `X_CONTRACT_SUPPORTED_VERSIONS` sabitine bağlandı; `contracts-check.ts`'in örnek verileri yeni v1.1.0 alanlarını içerecek şekilde güncellendi ve `npm run check:contracts` yeniden **17/17 yeşil** döndü (Workspace ve Dependency artık `version=1.1.0` olarak raporlanıyor).

`WorkspaceContract`'ın eski `project` alanı v1.1.0'a taşınmadı (Contract seviyesinde artık yok) — ancak `JobWorkspacePaths` (internal, `AdobeWorkspaceService`) alanı korundu, çünkü mevcut, test edilmiş Adobe Runtime kodu hâlâ ona bağımlı; bu iki tip kasıtlı olarak birleştirilmedi (bkz. Bölüm 3).

## 2. JobWorkspacePaths Genişlemesi

`AdobeWorkspaceService`'teki `JobWorkspacePaths` arayüzüne 4 yeni klasör eklendi, hem `getJobWorkspacePaths()` hem `createJobWorkspace()` güncellendi (gerçek `mkdir`):

```
jobs/{job_uuid}/
  source/        — (mevcut) indirilen template asset'i
  project/       — (mevcut) Adobe Runtime'ın kullandığı proje klasörü
  preview/master/logs/temp/cache/  — (mevcut)
  dependency/    — YENİ: dependency package'tan gelen, işe özel asset'ler (örn. assets/)
  extracted/     — YENİ: ProjectExtractor'ın derinlik-bazlı (depth-0, depth-1, ...) extract çıktısı
  manifest/      — YENİ: extract edilen projeden doğrulanan manifest.json'ın kopyası
  variables/     — YENİ: VariableFileBuilder'ın ürettiği variables.json
```

Hiçbir mevcut alan kaldırılmadı — Phase 3'ün `DependencyPackageService`/`ScriptPreparerService` kodu değişmeden çalışmaya devam ediyor.

## 3. Dependency Package'a 3 Yeni Tür: LUT / Expression / Asset

Phase 3'ün `adobe/dependency/` modülüne, mevcut Font/Preset/Script desenleri birebir takip edilerek 3 yeni servis eklendi:

- **`LutInstallerService`** / **`ExpressionInstallerService`** — Font/Preset ile aynı desen: paylaşımlı, node-geneli, idempotent (`copyDirectoryContents`), enjekte edilmiş bir hedef klasöre kurulum.
- **`DependencyAssetInstallerService`** — Script ile aynı desen: işe özel, paylaşımlı DEĞİL, `jobWorkspace.dependency/assets` altına kopyalanır (assets genellikle projeye özel kaynaklardır — footage/görsel — paylaşımlı fontlar/preset'lerin aksine).

`DependencyManifest` (local, Contract'tan bağımsız tip — Phase 3'ün kendi okuyucusu için) ve `DependencyContract` (Registry seviyesi) **paralel olarak** genişletildi, birleştirilmedi — Phase 3'ün test edilmiş `DependencyManifestReader`/`DependencyPackageService` kodunu riske atmamak için bilinçli bir tercih. `DependencyPackageService.ensureInstalled()` artık 3 yeni installer'ı da çağırıyor; `DependencyVerificationService.verify()` yeni türleri de isimle (by-name) doğruluyor; `DependencyInstallationReport` yeni alanları taşıyor.

**Gerçek doğrulama**: `npm run check:dependency` güncellenmiş synthetic paketle (artık `luts/`, `expressions/`, `assets/` klasörleri de içeriyor) hem cache-miss hem cache-hit senaryosunda READY döndü; ikinci çalıştırmada 3 yeni tür de doğru şekilde "skipped" (zaten kurulu) olarak raporlandı.

## 4. `src/preparation/` — Yeni Modül

| Dosya                            | Sorumluluk                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `prepared-project.types.ts`      | `PreparedProjectStatus` (READY/FAILED) + `PreparedProject` — pipeline'ın **tek** çıktı şekli                             |
| `workspace-contract.mapper.ts`   | `JobWorkspacePaths` → `WorkspaceContract` — tek üretim noktası, hiçbir çağıran elle Contract kurmaz                      |
| `template-cache.service.ts`      | `TemplateCacheService` — templateUuid → asset hash önbelleği (DependencyCacheService'e dokunulmadan, ayrı, benzer desen) |
| `template-download.service.ts`   | `TemplateDownloadService` — bkz. Bölüm 5                                                                                 |
| `project-extractor.ts`           | `ProjectExtractor` — bkz. Bölüm 6                                                                                        |
| `project-validator.ts`           | `ProjectValidator` — bkz. Bölüm 7                                                                                        |
| `variable-file-builder.ts`       | `VariableFileBuilder` — bkz. Bölüm 8                                                                                     |
| `project-preparation.service.ts` | `ProjectPreparationService` — orkestratör, bkz. Bölüm 9                                                                  |
| `index.ts`                       | Barrel (capabilities/contracts ile aynı desen)                                                                           |

## 5. Template Download — Mock Sınırı ve Gerçek Kısımlar

`IApiClient`'a Faz 4'te eklenen **tek** yeni metod: `getTemplateAsset(templateUuid): Promise<AssetContract>` (mock — Laravel API'si henüz yok, `ApiClient` diğer tüm metodlarıyla aynı `[mock] GET ...` log deseniyle). Gerçek dosya baytlarının HTTP üzerinden indirilmesi bu fazda da kapsam dışı (Phase 3'teki `DependencyPackageService`'in `localZipPath` alması ile aynı ilke) — `TemplateDownloadService.download()` "zaten indirilmiş" bir yerel dosya yolu alır.

Mock'un döndürdüğü `asset.hash` gerçek bir dosyaya karşılık gelemeyeceği için (henüz gerçek bir backend yok), `TemplateDownloadService` bunu hiçbir zaman doğrulama için kullanmaz. Bunun yerine:

1. `AssetContract`'ın zarfı + `type === PROJECT` olması **gerçekten** doğrulanır (`ContractRegistry.validate`).
2. Yerel dosyanın **gerçek** SHA-256 hash'i hesaplanır (yeni `utils/hash-file.ts`, stream tabanlı).
3. Bu gerçek hash, `TemplateCacheService`'te önbellek anahtarı olarak kullanılır — aynı bayt içeriği → cache hit, farklı içerik → cache miss (gerçek, test edilebilir davranış).
4. Dosya `jobWorkspace.source`'a **gerçekten** kopyalanır.

## 6. ProjectExtractor — Gerçek, Rekürsif Unzip-and-Search

Spec'in literal `.mogrt → .aegraphic → project.zip → .aep` zincirini hardcode etmek yerine genel bir algoritma yazıldı: bir arşivi extract et, `.aep` ara; yoksa iç içe bir arşiv (`.zip`/`.mogrt`/`.aegraphic`) ara ve onunla tekrarla (`MAX_EXTRACTION_DEPTH = 5` güvenlik sınırı ile).

**Geliştirme sırasında gerçek bir Envato-tarzı MOGRT örnek ürünle elle doğrulandı** (kullanıcının Downloads klasöründeki gerçek bir ürün ZIP'i): gerçek yapı, spec'in tahmin ettiğinden daha basit çıktı — `outer.zip` kökünde doğrudan bir `project.aegraphic` dosyası var, o da kendi kökünde doğrudan `.aep`'i içeriyor (2 seviye, spec'teki 4 seviyeli zincirden daha sığ). Genel algoritma, hardcoded zincir yazılmış olsaydı YANLIŞ olacak bu gerçek yapıyı hiçbir özel durum kodu olmadan doğru buldu — bu, genel yaklaşımın doğru tercih olduğunu kanıtladı. `npm run check:preparation`'daki committed test ise (repo dışı bir dosyaya bağımlı kalmaması için) **synthetic** ama aynı 2 seviyeli yapıyı taklit eden bir paket kullanıyor (`outer.zip → project.aegraphic → project.aep + manifest.json`).

## 7. ProjectValidator — Manifest Doğrulama

Extract edilen dizinde rekürsif olarak `manifest.json` aranır (Scanner'ın gelecekte üreteceği, halihazırda Contract katmanında tanımlı `ManifestContract` şeklinde varsayılır — bu proje henüz bir Scanner içermiyor, dolayısıyla test fixture'ı manifest.json'ı elle inşa ediyor). Bulunca:

1. JSON parse edilir, `ContractRegistry.validate(MANIFEST, ...)` ile zarf + alan doğrulaması yapılır.
2. `isContractVersionCompatible()` ile bu node'un desteklediği Manifest major versiyonuyla karşılaştırılır — uyumsuzsa `ProjectValidationError`.
3. Doğrulanan dosya `jobWorkspace.manifest/manifest.json`'a kopyalanır (kalıcı, denetlenebilir kayıt).

Ne manifest.json bulunamaması ne de versiyon uyumsuzluğu "yoksay" edilir — ikisi de gerçek, tipli hatalar fırlatır.

## 8. VariableFileBuilder — variables.json

`ManifestContract.variables` (her biri key/label/type/defaultValue/sortOrder) ile `RenderJobContract.variables` (Laravel'den gelen, key→değer haritası) eşleştirilir: job bir değer sağlamışsa o kullanılır, sağlamamışsa manifest'in `defaultValue`'su kullanılır, ikisi de yoksa `VariableFileBuildError` fırlatılır (eksik zorunlu değişken). Sonuç `jobWorkspace.variables/variables.json`'a gerçek olarak yazılır.

**Gerçek testte doğrulanan senaryo**: `title_text` job tarafından sağlandı, `subtitle_text` sağlanmadı ve manifest'teki `defaultValue`'dan (`"Varsayılan Alt Başlık"`) doğru şekilde dolduruldu; üretilen dosya beklenen JSON ile birebir eşleşti.

## 9. ProjectPreparationService — Orkestratör

Tam akış, kesin bu sırayla:

```
Capability Registry ön-kontrolü (supports())
        │  (yetersizse: NodeNotCapableError, hiçbir workspace oluşturulmaz)
        ▼
Job Workspace oluştur (AdobeWorkspaceService)
        │
Template asset indir/doğrula/kopyala (TemplateDownloadService)
        │
Dependency Package kur (DependencyPackageService — Faz 3, değişmedi)
        │  (verification READY değilse: pipeline FAILED)
        ▼
Proje (.aep) extract et (ProjectExtractor)
        │
Manifest doğrula (ProjectValidator)
        │
variables.json üret (VariableFileBuilder)
        │
        ▼
PreparedProject { status: READY, projectFilePath, variablesFilePath, workspace, errors: [] }
```

Capability ön-kontrolü **iş parçacığı başlamadan önce**, hiçbir Job Workspace oluşturmadan çalışır — spec'in "hiçbir zaman rastgele/yetersiz node'a iş verilmez" ilkesinin bu fazdaki karşılığı. Pipeline'ın geri kalanı bir `try/catch` içinde: herhangi bir adım (indirme, dependency, extraction, validation, variable eşleme) tipli bir hata fırlatırsa, `ProjectPreparationService` bunu yutmaz ama `PreparedProject { status: FAILED, errors: [mesaj] }` şeklinde **yapılandırılmış bir sonuca** çevirir — `DependencyVerificationResult`'ın READY/MISSING_DEPENDENCIES desenine bilinçli olarak paralel, gelecekteki bir `JobManager`'ın "render'a geç" ya da "`apiClient.jobFailed()` çağır" kararını net bir statü üzerinden verebilmesi için.

## 10. Uçtan Uca Doğrulama: `npm run check:preparation`

Yeni `src/preparation-check.ts`, `dependency-check.ts`/`capabilities-check.ts` presedentiyle aynı şekilde gerçek, mock-olmayan bir senaryo çalıştırıyor (yalnızca `IApiClient.getTemplateAsset()` mock'lanıyor — Laravel API'si henüz yok):

1. **1. çalıştırma** (yeni templateUuid): pipeline tamamlanır, `status === READY`, `projectFilePath` ve `variablesFilePath` diskte gerçekten var, `variables.json` içeriği beklenenle birebir eşleşiyor (default-value fallback dahil).
2. **2. çalıştırma** (aynı templateUuid + aynı yerel dosyalar, farklı jobUuid): hem `TemplateDownloadService` (asset hash cache) hem `DependencyPackageService` (Phase 3'ün mevcut cache'i) **cache hit** raporluyor; sonuç yine READY.
3. **Capability ön-kontrolü**: `after-effects` desteklemeyen bir node raporuyla çağrıldığında `NodeNotCapableError` fırlatıldığı doğrulandı — hiçbir Job Workspace oluşturulmadı.

Tüm test artefaktları (job workspace'ler, synthetic zip'ler, scratch font/preset/lut/expression klasörleri, cache dosyaları) script sonunda temizleniyor; gerçek sistem klasörlerine (Fonts, Media Encoder presets vb.) hiç dokunulmuyor.

## 11. Regresyon Doğrulaması

`npm run typecheck`, `npm run lint`, `npx prettier --write .`, `npm run build` temiz. Mevcut tüm check script'leri yeniden çalıştırıldı ve yeşil: `check:contracts` (17/17, Workspace+Dependency artık v1.1.0), `check:capabilities` (register/update/compare/supports/findBestNode), `check:dependency` (yeni LUT/Expression/Asset türleri dahil, cache-hit/miss). Bu faz `main.ts`/`JobManager`'a bağlanmadı — Phase 3'ün `DependencyPackageService`'i gibi, gerçek entegrasyon (JobManager'ın bir job aldığında `ProjectPreparationService.prepare()`'i çağırması) gelecekteki bir Render Engine fazına bırakıldı.

---

## Doğrulama Özeti

`npm run check:preparation`: Job Workspace → Template download (gerçek SHA-256 + gerçek cache) → Dependency Package kurulumu (Faz 3, LUT/Expression/Asset dahil) → gerçek rekürsif unzip-and-search ile `.aep` bulma → Manifest Contract doğrulama → `variables.json` üretimi zinciri uçtan uca, iki ayrı çalıştırmada (cache-miss + cache-hit) ve bir capability-red senaryosunda doğrulandı. `ProjectExtractor`'ın genel algoritması ayrıca geliştirme sırasında gerçek bir Envato-tarzı MOGRT örnek ürünle elle doğrulandı ve spec'in varsaydığından daha sığ olan gerçek arşiv yapısını hiçbir özel durum kodu gerekmeden doğru buldu.
