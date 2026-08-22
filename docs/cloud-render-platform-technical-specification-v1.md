# Cloud Render Platform Technical Specification v1.0

**Statü:** Taslak — onay bekliyor. Bu doküman onaylanmadan Laravel API / Scanner / Render Node tarafında bu sözleşmeyi ilgilendiren yeni kod yazımına başlanmaz.

**Kapsam:** Bu doküman bir **implementasyon** değil, **mimari sözleşmedir**. Amacı, Scanner, Laravel API ve Render Node'un birbirinden bağımsız ekipler tarafından geliştirilebilmesi için aralarındaki veri şemasını, veri akışını ve davranışsal kuralları tek, otoriter bir kaynakta sabitlemektir. Bir ekip bu dokümana uyduğu sürece, diğer ekiplerin iç implementasyon detaylarını bilmesine gerek kalmaz.

**Temel ilke:** Bu doküman **var olan, gerçek çalışan davranışı** belgeler — hiçbir bölüm varsayımsal/planlanan bir özelliği "zaten var" gibi sunmaz. Gerçek referans implementasyonlar (`generate_manifest.jsx`, `apply_manifest.jsx`, gerçek `manifest.json`/`variables.json` örnekleri, `pratiktools-render-node`'un Contract katmanı, `pratiktools-site`'ın `template_variables`/`render_project_variables` şeması ve gerçek `CloudRenderStatus` enum'u) temel alınmıştır. Henüz var olmayan parçalar (bkz. §13) açıkça "kapsam dışı" olarak işaretlenmiştir. **Registration Token mekanizması, Template ve Token durum makineleri, ve Manifest Upload API sözleşmesi (§2, §3, §5.6, §9) bu ilkenin istisnasıdır:** bunlar henüz implemente edilmemiş, ama mimari olarak **onaylanmış (APPROVED/FINAL)**, zorunlu gereksinimlerdir — metinde bu bölümler bilinçli olarak "gerekli"/"olmalı" ifadeleriyle yazılmıştır, "zaten çalışıyor" gibi sunulmamıştır. Uygulama sırası için bkz. §14 (Uygulama Yol Haritası).

---

## 1. Sistem Aktörleri ve Sorumlulukları

Üç bağımsız sistem, bu sözleşmenin sınırlarında buluşur:

| Aktör           | Sorumluluk                                                                                                                                                                                                                                                                               | Bu sözleşmedeki rolü                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Scanner**     | Bir Registration Token ile doğrulanır (§2), gerçek bir After Effects projesini (`.aep`) tarar, Essential Graphics'te yayınlanmış değişkenleri keşfeder. Referans implementasyon: `generate_manifest.jsx`.                                                                                | **Manifest**'i üretir (§5.2/§5.3) ve upload eder (§5.6).                         |
| **Laravel API** | Registration Token üretir (§2), Scanner'ın ürettiği Manifest'i **bir kez** parse edip kalıcı hale getirir (`template_variables` tablosu — §11), bir render talebi geldiğinde gerçek değerleri (`render_project_variables`) toplar, Render Node'a bir **RenderJob** olarak dispatch eder. | Registration Token'ı **üretir**; Manifest'i **tüketir**; RenderJob'ı **üretir**. |
| **Render Node** | Bir RenderJob alır, gerçek `.aep`'i açar, değişkenleri gerçek AE property'lerine uygular (referans davranış: `apply_manifest.jsx`), render alır, çıktıyı yükler.                                                                                                                         | Manifest + RenderJob'ı **tüketir**.                                              |

Bu üç aktör hiçbir zaman birbirinin iç kodunu bilmek zorunda değildir — yalnızca bu dokümanda tanımlı JSON şekillerine ve davranış kurallarına uymaları yeterlidir.

---

## 2. Registration Token Yaşam Döngüsü

### 2.1 Neden var

Manifest, tanımı gereği **motor-bağımsız** (engine-independent) bir artifact'tır (§5.1) — hiçbir veritabanı kimliği taşımaz. Bu durumda Laravel, gelen bir Manifest Upload isteğinin **gerçekten hangi template'e ait olduğunu** ve **gerçekten yetkili bir kaynaktan geldiğini** nasıl bilecek? Registration Token tam olarak bu boşluğu doldurur: Manifest'in "kimliksiz" (template'e dair hiçbir DB bilgisi taşımayan) kalabilmesini sağlarken, yine de doğru template'e güvenli şekilde bağlanmasını garanti eden tek mekanizmadır.

### 2.2 Nasıl ilişkilendirir

Bir Registration Token, oluşturulduğu anda Laravel tarafında **tek bir template'e** bağlanır (token↔template eşlemesi Laravel'in kendi veri modelidir — bu dokümanın kapsamı dışı, bkz. §13). Scanner, Manifest Upload isteğinde (§5.6) yalnızca token'ı gönderir; Laravel, token'ı çözerek hangi template'in `template_variables`'ına yazacağını kendi tarafında bilir. **Manifest'in kendisi bu ilişkiyi hiçbir zaman taşımaz.**

### 2.3 Kim üretir, kim doğrular

- **Laravel, tarama başlamadan önce** bir Registration Token üretir (bkz. §2.5 iş akışı — Admin `.aep`'i indirmeden önce). Bu, yalnızca template `Approved` veya `Ready` durumundaysa yapılabilir (§3).
- **Scanner, Manifest üretimine izin vermeden önce** bu token'ı doğrular (Laravel'e sorar). Token geçersizse (hiç üretilmemiş, süresi geçmiş veya daha önce kullanılmış), Scanner render-ayarları adımlarına **hiç geçmez** — Manifest üretilmez (bkz. §9, Scanner UI Akışı).

### 2.4 Tek kullanımlıktır

Bir Registration Token, bir kez başarılı bir Manifest Upload işleminde (§5.6) kullanıldıktan sonra Laravel tarafında geçersiz kılınır (§2.6: `Consumed`). Aynı token ile ikinci bir upload denemesi **reddedilir**. Bu kural, eski veya yanlışlıkla tekrar çalıştırılan bir Scanner oturumunun aynı template'in `template_variables`'ını istemeden ikinci kez (ve belki farklı bir sonuçla) değiştirmesini engeller.

### 2.5 Operasyonel iş akışı

```
Author, Cloud Render onayı talep eder
        │
        ▼
Laravel bir Registration Token üretir (tek kullanımlık, tek template'e bağlı)
        │
        ▼
Admin, ilgili .aep dosyasını indirir
        │
        ▼
Scanner, After Effects içinde açılır
        │
        ▼
Registration Token doğrulanır (§2.3 — geçersizse akış burada durur)
        │
        ▼
Admin render ayarlarını onaylar (§7/§9 — renderComposition/requiresAlpha/renderDurationSeconds)
        │
        ▼
Manifest üretilir (§5.1)
        │
        ▼
Manifest upload edilir ({registrationToken, manifest} — §5.6)
```

### 2.6 Token Durum Makinesi

Registration Token'ın kendi yaşam döngüsü, Template'in yaşam döngüsünden (§3) **bağımsızdır** — bir token'ın durumu, template'in durumunu doğrudan değiştirmez; yalnızca template'in durum geçişlerini **tetikleyebilir** (örn. token `Consumed` olunca template `WaitingManifest`'ten `Ready`'ye geçer, §3).

| Durum       | Anlamı                                                                                                   | İzinli geçişler                         | Terminal mi? | Kim değiştirir                                       |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------ | ---------------------------------------------------- |
| `Generated` | Laravel token'ı üretti, henüz Scanner tarafından doğrulanmadı.                                           | → `Validated`, → `Expired`, → `Revoked` | Hayır        | Laravel (üretir)                                     |
| `Validated` | Scanner, token'ı Laravel'e sorup geçerli bulmuş; Manifest üretimine izin verildi, henüz upload edilmedi. | → `Consumed`, → `Expired`, → `Revoked`  | Hayır        | Scanner (doğrulama isteği üzerine Laravel işaretler) |
| `Consumed`  | Manifest başarıyla upload edilip işlendi (§5.6). Token artık kullanılamaz.                               | _(yok — terminal)_                      | **Evet**     | Laravel (Manifest Upload başarıyla tamamlanınca)     |
| `Expired`   | Token, kullanılmadan süresi doldu.                                                                       | _(yok — terminal)_                      | **Evet**     | Laravel (zamanlanmış kontrol)                        |
| `Revoked`   | Admin, henüz kullanılmamış bir token'ı elle iptal etti (örn. yanlışlıkla üretildi).                      | _(yok — terminal)_                      | **Evet**     | Admin                                                |

**Not:** `Validated` durumu, token'ın **doğrulandığı** anı temsil eder; bu, Manifest'in gerçekten upload edildiği anlamına gelmez. Bir token `Validated` durumdayken süresi dolabilir (Scanner açıldı, doğrulama geçti, ama admin render ayarlarını hiç onaylamadan AE'yi kapattı) — bu durumda `Expired`'a düşer, Manifest asla üretilmez ve template `Approved`'a geri döner (§3).

---

## 3. Template Durum Makinesi

Bu bölüm, bir template'in Cloud Render'a dahil olma talebinden render'a hazır olmasına kadar geçirdiği tüm durumları tanımlar. Bu state machine, `pratiktools-site`'ın gerçek, halihazırda var olan `CloudRenderStatus` enum'u (`app/Models/ProductRenderTemplate.php`) üzerine kuruludur — sıfırdan icat edilmemiştir.

**Terminoloji notu (önemli):** Bu dokümanın mimari terminolojisinde, Registration Token üretilip Manifest beklenen duruma **`WaitingManifest`** denir. Mevcut Laravel enum'unda bu, `Processing` adlı (zaten var olan) değerle temsil edilir — enum'un string değeri **değiştirilmemiştir** (geriye dönük uyumluluk, gereksiz bir migration'dan kaçınmak için). Yani:

> **`Processing` (legacy enum değeri) == `WaitingManifest` (mimari/domain kavramı)**

Bu dokümanın geri kalanında, kod referansı gerekmedikçe her zaman `WaitingManifest` terimi kullanılır. `Processing` adı kasıtlı olarak tercih edilmemiştir çünkü bir Render Job'ın kendi işlenme durumuyla (render kuyruğunda "processing" olması, §10) karıştırılmaya çok açıktır — bu, template'in kendi durumu, bir render işinin durumu değildir.

### 3.1 Durum Tablosu

| Durum             | Amaç                                                                              | İzinli geçişler                                                                                     | Yasak geçişler                                             | Kim tetikler                                                    | Token üretimi                     | Manifest upload                     | Render Job                                             |
| ----------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `NotRequested`    | Author, Cloud Render'ı henüz talep etmemiş.                                       | → `Requested`                                                                                       | `Approved`/`WaitingManifest`/`Ready`/`Archived`'a doğrudan | Author                                                          | Hayır                             | Hayır                               | Hayır                                                  |
| `Requested`       | Admin incelemesi bekleniyor.                                                      | → `Approved`, → `Rejected`, → `NotRequested` (geri çekme)                                           | `WaitingManifest`/`Ready`/`Archived`'a doğrudan            | Admin (onay/red), Author (geri çekme)                           | Hayır                             | Hayır                               | Hayır                                                  |
| `Approved`        | Onaylandı; onboarding (Scanner/Manifest) henüz başlamadı.                         | → `WaitingManifest` (token üretilince), → `Disabled`                                                | `Ready`'ye doğrudan, `NotRequested`'a                      | Admin/Sistem (token üretimi)                                    | **Evet**                          | Hayır (henüz token yok)             | Hayır                                                  |
| `WaitingManifest` | Registration Token üretildi (§2.6: `Generated`/`Validated`); Manifest bekleniyor. | → `Ready` (Manifest başarıyla işlendi), → `Approved` (token `Expired`/`Revoked` oldu), → `Disabled` | `Requested`/`NotRequested`/`Archived`'a doğrudan           | Scanner/Sistem (başarı), Sistem (token expiry), Admin (disable) | Hayır (zaten aktif bir token var) | **Evet**                            | Hayır                                                  |
| `Ready`           | `template_variables` güncel; render'a hazır.                                      | → `WaitingManifest` (yeniden tarama = yeni token), → `Disabled`, → `Archived`                       | `Requested`/`NotRequested`/`Rejected`'a                    | Admin (yeniden tarama/disable/archive)                          | **Evet** (yeniden tarama)         | Hayır (sadece `WaitingManifest`'te) | **Evet — tek izinli durum**                            |
| `Rejected`        | Admin, talebi reddetti. `Requested`'tan bir yan dal.                              | → `Requested` (yeniden başvuru)                                                                     | `Approved`/`WaitingManifest`/`Ready`'ye doğrudan           | Admin (red), Author (yeniden başvuru)                           | Hayır                             | Hayır                               | Hayır                                                  |
| `Disabled`        | Geçici askıya alma (geri döndürülebilir).                                         | → `Approved` veya → `Ready` (yeniden aktifleştirme, önceki durum ve admin kararına göre)            | `NotRequested`/`Requested`/`Rejected`'a                    | Admin                                                           | Hayır                             | Hayır                               | Hayır                                                  |
| `Archived`        | Kalıcı emeklilik — **terminal**.                                                  | _(v1'de yok — geri dönüş yok)_                                                                      | Her şey                                                    | Admin (yalnızca `Ready`/`Disabled`'dan)                         | Hayır                             | Hayır                               | Hayır (mevcut render kayıtları görüntülenebilir kalır) |

### 3.2 Tasarım Notları

- `WaitingManifest` ile `Ready` arasında ayrı bir "Manifest Uploaded" durumu **yoktur** — Manifest işleme (§5.6, adım 3) senkron olduğu için, başarılı bir upload'ın hemen ardından template doğrudan `Ready`'ye geçer.
- `WaitingManifest` durumunda yeni bir token üretimi **yasaktır** — bu, "aynı anda tek aktif token" kuralını state machine'in kendisi üzerinden, ayrı bir kilit mekanizmasına gerek kalmadan garanti eder.
- `Archived`, v1'de **kasıtlı olarak terminal**dir — geri dönüş gerekirse yeni bir template kaydı oluşturulur, bir eskisi yeniden canlandırılmaz (gereksiz karmaşıklıktan kaçınma).
- Bu state machine'in Laravel tarafındaki kesin implementasyonu (geçiş guard'ları, event/listener yapısı vb.) bu dokümanın kapsamı dışındadır — bkz. §14.

---

## 4. Ortak Zarf: Contract Envelope

Bu sözleşmenin sınırından geçen **her** JSON nesnesi (Manifest, TemplateVariable) aynı üç alanı taşır:

| Alan        | Tip                     | Açıklama                                                                                                                        |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `schema`    | `string`                | Sabit bir tanımlayıcı (`"manifest"`, `"template-variable"`). Alıcı, beklediği `schema` değeriyle eşleşmiyorsa nesneyi reddeder. |
| `version`   | `string` (semver)       | Bu şemanın kendi versiyonu — diğer şemalardan bağımsız evrilir.                                                                 |
| `createdAt` | `string` (ISO 8601 UTC) | Nesnenin üretildiği an.                                                                                                         |

**v1.0 için geçerli versiyonlar:** `manifest` şeması için `1.0.0`, `template-variable` şeması için `1.0.0`. Bu iki numara birbirinden bağımsızdır; biri değişse diğeri değişmek zorunda değildir.

**Uyumluluk kuralı:** Alıcı taraf, gelen `version`'ı kendi desteklediği versiyonla karşılaştırır. Majör versiyon uyuşmazlığında (örn. `2.x` gelirken `1.x` bekleniyorsa) nesne reddedilir — sessizce en iyi çaba ile işlenmeye çalışılmaz.

**Not:** Bu envelope'daki `version`, yalnızca **şemanın (yapının)** versiyonudur — bir Manifest **içeriğinin** geçmiş sürümlerini temsil etmez. İçerik versiyonlama/geçmiş kavramı bu projede kasıtlı olarak yoktur, bkz. §11.

---

## 5. Veri Modeli

### 5.1 Manifest (Scanner → Laravel API)

Bir Scanner taramasının **tüm** çıktısı, tek bir Manifest nesnesidir:

```json
{
  "schema": "manifest",
  "version": "1.0.0",
  "createdAt": "2026-07-30T12:07:33.733Z",
  "schemaVersion": "1.0.0",
  "scannerVersion": "1.0.0",
  "engine": "after-effects",
  "variables": [/* TemplateVariable[], bkz. §5.2 */],
  "metadata": {
    "renderComposition": "Final Comp",
    "requiresAlpha": false,
    "renderDurationSeconds": 10.02
  }
}
```

| Alan             | Tip                  | Zorunlu                  | Açıklama                                                                                                                                    |
| ---------------- | -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`  | `string`             | Evet                     | Manifest'in **iç yapısının** versiyonu (envelope'un `version`'ından ayrı — ileride bu iç yapı Contract versiyonundan bağımsız evrilebilir). |
| `scannerVersion` | `string`             | Evet                     | Taramayı üreten Scanner script'inin kendi versiyonu (izlenebilirlik için).                                                                  |
| `engine`         | `string`             | Evet                     | Şu an için tek geçerli değer: `"after-effects"`.                                                                                            |
| `variables`      | `TemplateVariable[]` | Evet                     | Bkz. §5.2. Boş dizi olabilir (hiç EGP değişkeni yayınlanmamış proje).                                                                       |
| `metadata`       | `object`             | Evet (boş obje olabilir) | Manifest-seviyesi, değişkenlerden bağımsız render ayarları — bkz. §7.                                                                       |

**Manifest'in kesinlikle taşımaması gerekenler:** Manifest, tanımı gereği **motor-bağımsız** (engine-independent) bir artifact'tır — hangi template'e, hangi Laravel kurulumuna ait olduğunu bilmez ve bilmemelidir. Bu yüzden bir Manifest **asla** şunları içermez:

- `templateId` / `templateUuid`
- Herhangi bir veritabanı kimliği (birincil anahtar, foreign key vb.)
- Laravel'e özgü herhangi bir bilgi (kullanıcı, ürün, sipariş vb.)

Bir Manifest'in hangi template'e ait olduğu bilgisi, Manifest'in **dışında**, Registration Token aracılığıyla taşınır (§2, §5.6) — **asla Manifest JSON'unun içine gömülmez.**

**Not (karışıklığı önlemek için):** Bu kural yalnızca Manifest için geçerlidir. RenderJob (§5.5), Laravel'in **kendi** ürettiği, zaten veritabanına yazılmış verilerden kurduğu bir nesnedir ve `templateUuid` taşır — bu bir çelişki değildir: RenderJob bir Scanner çıktısı değil, Laravel'in dahili dispatch formatıdır.

### 5.2 TemplateVariable (`manifest.variables[]` öğesi)

```json
{
  "schema": "template-variable",
  "version": "1.0.0",
  "createdAt": "2026-07-30T12:07:33.377Z",
  "key": "MainText_Your Text_1",
  "label": "Your Text",
  "type": "TEXT",
  "defaultValue": "YOUR TEXT HERE",
  "sortOrder": 0,
  "metadata": {
    "compositionName": "MainText",
    "layerName": "Text",
    "propertyPath": ["Text", "Source Text"],
    "propertyMatchName": "ADBE Text Document"
  }
}
```

| Alan           | Tip                                               | Zorunlu              | Açıklama                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`          | `string`                                          | Evet                 | Bir Manifest içinde **benzersiz**. Render sırasında `variables.json`'daki (§5.4) değeri bu `key` ile eşleştirilir. Scanner'ın ürettiği gerçek `key`'ler `{compositionName}_{displayName}_{sıra}` deseniyle üretilir (örn. `Color_Text Size_3`) — biçim sabit bir sözleşme değildir, sadece benzersizlik garanti edilir.                                                                                                                              |
| `label`        | `string`                                          | Evet                 | İnsan tarafından okunabilir görünen ad (EGP'de yayınlanan gerçek isim).                                                                                                                                                                                                                                                                                                                                                                              |
| `type`         | `string` (VariableType, §5.3)                     | Evet                 | Büyük harfle (`TEXT`, `NUMBER`, ...).                                                                                                                                                                                                                                                                                                                                                                                                                |
| `defaultValue` | `string \| number \| boolean \| number[] \| null` | Evet (null olabilir) | Taramanın yapıldığı andaki gerçek değer. **Bilinen tutarsızlık:** Render Node'un Contract tanımında bu alan `string \| null` olarak daraltılmış görünüyor; gerçekte COLOR/POINT2D/POINT3D için dizi, BOOLEAN için gerçek boolean, NUMBER/ANGLE için sayı geliyor. v1'de bu JSON-seviyesinde sorun çıkarmıyor (tip zaten `unknown` olarak taşınıyor) ama Render Node'un TypeScript tipi gelecekte bu gerçek davranışa göre genişletilmeli — bkz. §13. |
| `sortOrder`    | `number`                                          | Evet                 | Manifest içindeki 0-tabanlı gösterim sırası.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `metadata`     | `object`                                          | Evet                 | Bu değişkenin gerçek AE adresi — bkz. §6.                                                                                                                                                                                                                                                                                                                                                                                                            |

### 5.3 VariableType

| Değer                           | Scanner tarafından üretilebiliyor mu? | Açıklama                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT`                          | ✅                                    | `ADBE Text Document` (Source Text).                                                                                                                                                                                                                                                                                                                                             |
| `NUMBER`                        | ✅                                    | Genel sayısal slider.                                                                                                                                                                                                                                                                                                                                                           |
| `ANGLE`                         | ✅                                    | `matchName`'inde `"Angle"` geçen slider'lar.                                                                                                                                                                                                                                                                                                                                    |
| `BOOLEAN`                       | ✅                                    | `matchName`'inde `"Checkbox"` geçen kontroller.                                                                                                                                                                                                                                                                                                                                 |
| `COLOR`                         | ✅                                    | `ADBE Color Control`. `[r,g,b,a]`, 0–1 aralığında float.                                                                                                                                                                                                                                                                                                                        |
| `POINT2D`                       | ✅                                    | `PropertyValueType.TwoD`/`TwoD_SPATIAL`.                                                                                                                                                                                                                                                                                                                                        |
| `POINT3D`                       | ✅                                    | `PropertyValueType.ThreeD`/`ThreeD_SPATIAL`.                                                                                                                                                                                                                                                                                                                                    |
| `DROPDOWN`                      | ❌ (henüz yok)                        | Render Node destekliyor (NUMBER gibi davranır), ama mevcut Scanner referansı bunu hiç üretmiyor.                                                                                                                                                                                                                                                                                |
| `IMAGE` / `VIDEO` / `AUDIO`     | ❌ (Essential Graphics dışı)          | Render Node bunları gerçek bir AE property'sine değil, **doğrudan layer'a** (`ReplaceSource`) bağlıyor — bu yüzden bu tipler için `propertyPath` boş dizi olabilir. Scanner'ın bugünkü EGP-tabanlı keşif mekanizması bu tipleri **üretmiyor**; bu üç tip bugün yalnızca elle hazırlanan manifestlerde (ör. test fixture'ları) var. **Bu, v1'de açık bir boşluktur** — bkz. §13. |
| Bilinmeyen bir AE property tipi | —                                     | Scanner `"unknown"` üretir; Render Node bunu `UNSUPPORTED_TYPE` olarak reddeder (sessizce atlamaz).                                                                                                                                                                                                                                                                             |

### 5.4 Değişken Değerleri (`variables.json` / RenderJob.variables)

Bir render işleminde gerçekten **uygulanacak** değerler, Manifest'ten tamamen ayrı, düz bir key→value nesnesidir:

```json
{
  "MainText_Your Text_1": "Merhaba Dünya",
  "Color_Text Size_3": 24,
  "Color_Text Color 1_11": [0.2, 0.2, 0.2, 1]
}
```

- Her anahtar, ilgili Manifest'in `variables[].key`'lerinden biriyle eşleşmelidir.
- Bir `key` bu nesnede yoksa, Manifest'teki karşılık gelen `defaultValue` kullanılır.
- Ne bu nesnede ne de `defaultValue`'da bir değer varsa, render işlemi **reddedilir** (eksik zorunlu değişken).

### 5.5 RenderJob (Laravel API → Render Node)

```json
{
  "schema": "render-job",
  "version": "1.0.0",
  "createdAt": "2026-07-30T12:10:00.000Z",
  "jobUuid": "f56a038e-558c-4206-af61-8a67e4b7054d",
  "templateUuid": "…",
  "projectUuid": "…",
  "userUuid": "…",
  "variables": {/* §5.4 */},
  "priority": "normal",
  "renderType": "preview"
}
```

| Alan         | Tip                           | Açıklama                                               |
| ------------ | ----------------------------- | ------------------------------------------------------ |
| `renderType` | `"preview" \| "master"`       | Hangi render profilinin (§7) kullanılacağını belirler. |
| `priority`   | `"low" \| "normal" \| "high"` | Kuyruklama önceliği.                                   |
| `variables`  | §5.4 şeklinde                 | Bu job için gerçek uygulanacak değerler.               |

`templateUuid` burada meşrudur (bkz. §5.1'deki "Not") — bu alan Manifest'in değil, Laravel'in kendi ürettiği RenderJob'ın parçasıdır.

### 5.6 Manifest Upload İsteği (Scanner → Laravel API)

Scanner, ürettiği Manifest'i Laravel'e şu şekilde gönderir:

```json
{
  "registrationToken": "rtk_9f8a2e1c...",
  "manifest": {/* §5.1 */}
}
```

| Alan                | Tip             | Açıklama                                                                                                                               |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `registrationToken` | `string`        | §2'de tanımlı, tek kullanımlık token. Manifest'in **dışında**, kardeş bir alan olarak taşınır — Manifest JSON'unun içine **gömülmez**. |
| `manifest`          | Manifest (§5.1) | Değişmeden, olduğu gibi.                                                                                                               |

Laravel bu isteği aldığında sırasıyla:

1. `registrationToken`'ı doğrular (geçerli mi, daha önce kullanılmış mı — §2.4).
2. Geçerliyse, token'ın bağlı olduğu template'i çözer (§2.2).
3. `manifest.variables[]`'ı `TemplateVariableService::syncFromScanResult()` ile o template'in `template_variables` satırlarına yazar (§11 — kanonik veri burada oluşur). Bu adım, template'in `WaitingManifest`'ten `Ready`'ye geçmesini tetikler (§3).
4. Token'ı kullanılmış (`Consumed`) olarak işaretler (§2.4, §2.6 — tek kullanımlık).

---

## 6. Property Çözümleme Algoritması (Davranışsal Sözleşme)

Bu bölüm, sistemin **en kritik davranışsal kuralını** tanımlar — bu kurallar hem gerçek referans (`apply_manifest.jsx`) hem de Render Node'un kendi implementasyonunda (`apply-variables.jsx`) birebir aynı şekilde uygulanmıştır ve **her yeni implementasyon bu davranışı korumak zorundadır.**

Bir `TemplateVariable.metadata` alanı şu alt-alanları taşır:

| Alan                | Tip        | Zorunlu mu                         | Açıklama                                                                                                                 |
| ------------------- | ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `compositionName`   | `string`   | **Evet**                           | Property'nin gerçekten yaşadığı composition. Farklı composition'larda aynı isimli layer'lar olabileceği için zorunludur. |
| `layerName`         | `string`   | **Evet**                           | `compositionName` içindeki layer adı.                                                                                    |
| `propertyPath`      | `string[]` | Medya-olmayan tipler için **Evet** | Layer'dan property'ye giden görünen-ad zinciri (dizi — `/`-ayrılmış string değil).                                       |
| `propertyMatchName` | `string`   | Hayır                              | Property'nin locale-bağımsız `matchName`'i — sadece fallback için kullanılır.                                            |

**Çözümleme sırası:**

1. **Composition çözümü** — `compositionName` ile projedeki composition'lar arasında ada göre ara. Bulunamazsa → hata (`COMPOSITION_NOT_FOUND`), bu değişken atlanır.
2. **Layer çözümü** — bulunan composition **içinde** `layerName` ile ara. Bulunamazsa → hata (`LAYER_NOT_FOUND`).
3. **PropertyPath gezintisi (birincil)** — `layer.property(propertyPath[0]).property(propertyPath[1])…` şeklinde sırayla gez. Zincirin herhangi bir adımı başarısız olursa (fail-soft — istisna yutulur), adım 4'e geç.
4. **matchName + displayName fallback (ikincil, sadece `propertyMatchName` mevcutsa)** — layer'ın **tüm** property ağacı recursive gezilir. `matchName === propertyMatchName` olan her aday için:
   - `prop.name` (görünen ad) `propertyPath`'in **son** elemanına tam eşitse → kesin eşleşme, arama biter.
   - Aksi halde → ilk matchName-only eşleşme hatırlanır (fallback).
   - Ağaç tamamen gezilip kesin eşleşme bulunamazsa, hatırlanan ilk matchName-only eşleşme kullanılır.
5. Hiçbiri bulunamazsa → bu değişken `PROPERTY_NOT_FOUND` ile başarısız sayılır. **Bu, tüm render işlemini durdurmaz** — o tek değişken atlanır, diğerleri uygulanmaya devam eder. Ancak işlem sonunda **en az bir değişken başarısızsa, toplam render job'ı BAŞARISIZ sayılır** (kısmi başarı yoktur — bir job ya tüm değişkenleriyle tam uygulanır ya da reddedilir).

**Neden bu sıra:** `propertyPath` çoğu durumda tek başına yeterlidir ve en hızlı/en kesin yoldur. `propertyMatchName` fallback'i, aynı tipten birden fazla effect/control aynı layer'da olduğunda (örn. iki "Slider Control") `propertyPath` bir noktada bozulmuşsa (effect yeniden adlandırılmış vb.) makul bir sonuca düşebilmek içindir.

---

## 7. Render Hedefi ve Render Ayarları (`manifest.metadata`)

Bir Manifest'in `metadata` alanı, hiçbir tek değişkene ait olmayan, **render işleminin kendisiyle** ilgili üç alan taşır. Bu alanların hiçbiri AE scripting'den %100 güvenilir şekilde otomatik çıkarılamaz — bu yüzden Scanner, manifest yazılmadan önce bir **admin onay adımı** (referans implementasyonda gerçek bir ScriptUI diyaloğu, bkz. §9) çalıştırır.

| Alan                    | Tip              | Zorunlu                                                                               | Varsayılan belirleme yöntemi                                                                                                                                                                                     |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderComposition`     | `string \| null` | Hayır (yoksa render motoru projedeki ilk composition'ı hedefler — riskli, bkz. aşağı) | Önce adında `"final comp"` geçen bir composition aranır; yoksa Essential Graphics'in yayınlandığı composition'a düşülür; o da yoksa `null` kalır. **Admin bu otomatik öneriyi bir dropdown'dan değiştirebilir.** |
| `requiresAlpha`         | `boolean`        | Hayır (varsayılan `false`)                                                            | Otomatik tespit edilemez — kreatif bir karardır (şablon şeffaf mı, tam ekran mı). Admin tarafından işaretlenir.                                                                                                  |
| `renderDurationSeconds` | `number \| null` | Hayır (yoksa composition'ın tam work area süresi render edilir)                       | `renderComposition`'ın **o anki work area süresi** varsayılan olarak önerilir; admin değiştirebilir.                                                                                                             |

**Önemli:** `renderComposition` boş bırakılırsa render motoru "ilk bulunan composition"u hedefler — bu, tek composition'lu projeler için güvenlidir ama **birden fazla composition'ı olan gerçek projelerde yanlış comp'un render edilmesine yol açabilir.** Bu yüzden gerçek projelerde bu alanın her zaman doldurulmuş olması **şiddetle önerilir**, zorunlu tutulmamıştır (geriye dönük uyumluluk için).

---

## 8. Essential Graphics Keşif Mekanizması (Scanner'ın iç çalışması)

Bu bölüm implementasyon detayına yakındır, ama sözleşmenin **neden** bu şekilde olduğunu anlamak için gereklidir:

1. Scanner geçici bir "sandbox" composition oluşturur.
2. Projedeki her gerçek composition'ı bu sandbox'a bir layer olarak nest eder.
3. O nested layer'ın `"ADBE Layer Overrides"` property group'unu okur — bu group **yalnızca nesting sonrası** dolar ve yayınlanmış Essential Graphics kontrollerine karşılık gelen "override proxy" property'leri içerir.
4. Bu group'u recursive gezerek her yaprağın `essentialPropertySource`'unu okur — bu, kontrolün arkasındaki **gerçek** property'yi döndürür.
5. O gerçek property'den yukarı çıkarak gerçek layer'ı ve composition'ı bulur (`.parentProperty` zinciri).
6. Aynı property birden fazla nesting seviyesinden yeniden expose edilebildiği için `compositionName|layerName|propertyPath` üçlüsüyle deduplicate edilir.

**Gereksinim:** After Effects CC 2022 (22.0) ve üzeri — `essentialPropertySource` bu sürümden itibaren mevcut.

---

## 9. Scanner Kullanıcı Arayüzü (UI) Akışı

Scanner, Manifest'i yazmadan önce admin'e sırayla şu adımları sunmalıdır:

```
Registration Token (admin girer/yapıştırır)
        ↓
Doğrula (Laravel'e sorulur — §2.3)
        ↓
Template Bulundu (doğrulanan token'ın bağlı olduğu template admin'e gösterilir)
        ↓
Render Composition (dropdown, otomatik öneri — §7)
        ↓
Requires Alpha (checkbox — §7)
        ↓
Render Duration (saniye, otomatik öneri — §7)
        ↓
Manifest Üret
```

**Statü:** Bu akışın **Render Composition / Requires Alpha / Render Duration** adımları (§7) referans implementasyonda gerçek, çalışan bir ScriptUI diyaloğu olarak zaten mevcuttur. **Registration Token / Doğrula / Template Bulundu** adımları ise bu akışın **başına eklenmesi gereken, henüz implemente edilmemiş** bir gereksinimdir (bkz. §14, Faz 1).

Bu sıra bilinçlidir: Registration Token doğrulanmadan render-ayarları adımlarına **hiç geçilmez** — geçersiz/kullanılmış bir token ile boşuna bir Manifest üretilmesi (ve sonra upload'ta reddedilmesi) engellenir.

---

## 10. Uçtan Uca Veri Akışı

```
Author, Cloud Render onayı talep eder
      │
      ▼
Laravel bir Registration Token üretir (§2)
      │
      ▼
Admin .aep'i indirir, Scanner'ı açar
      │
      ▼
[1] Scanner (§9 — UI akışı)
      │  Token doğrulanır (§2.3) → Essential Graphics tarar (§8) →
      │  admin render ayarlarını onaylar (§7) → Manifest üretilir (§5.1)
      ▼
[2] Manifest Upload {registrationToken, manifest} (§5.6) ──► Laravel API
                                        │  Token doğrulanır, Consumed işaretlenir (§2.4, §2.6)
                                        │  TemplateVariableService.syncFromScanResult()
                                        │  template_variables tablosuna YAZ (mevcut satırlar
                                        │  REPLACE edilir — bkz. §11, "tek aktif manifest")
                                        │  Template durumu WaitingManifest → Ready (§3)
                                        ▼
                                   template_variables (DB) ── kanonik veri, bkz. §11
                                        │
                                        │  Müşteri bir render talep eder, formda değer girer
                                        ▼
                                   render_project_variables (DB) ── §5.4'e eşdeğer
                                        │
                                        │  Laravel, RenderJob'ı (§5.5) kurar
                                        ▼
[3] RenderJob ──────────────────► Render Node
                                        │  Manifest'i (template_variables'tan türetilir, §11)
                                        │  + variables.json'ı (Laravel'den) alır
                                        │  Projeyi açar (job'a özel .aep kopyası)
                                        │  Property Çözümleme (§6) ile değerleri uygular
                                        │  renderComposition/requiresAlpha/renderDurationSeconds'a
                                        │  göre render kuyruğuna alır (§7)
                                        │  Render alır, çıktıyı yükler
                                        ▼
                                   Render sonucu (preview/master URL) → Laravel'e bildirilir
```

**Not:** `[2]`'den `[3]`'e giden gerçek HTTP/API katmanı (route'lar, controller'lar, authentication, Registration Token'ın Laravel-içi saklama/expiry mekanizması) bu dokümanın kapsamı **dışındadır** — bu doküman yalnızca bu adımların taşıdığı **veri şeklini** ve **davranış kurallarını** tanımlar. API'nin kendisi ayrı bir implementasyon fazıdır (bkz. §13, §14).

---

## 11. Tek Aktif Manifest ve Manifest'in Sahipliği

### 11.1 Kanonik Veri Mimarisi (Karar 1 — ONAYLANDI, final)

Platform resmi olarak şu mimariyi benimser:

```
.aep → Scanner → Manifest → Laravel Parser → Kanonik Veritabanı (template_variables)
```

Manifest **yalnızca bir taşıma artifact'ıdır** (transport artifact) — sistemin kaynak verisi (**source of truth**) **değildir**. Laravel, gelen her Manifest'i **tam olarak bir kez** parse eder; parse işleminden sonra `template_variables`, o template'in **tek ve yegâne kanonik tanımı** haline gelir.

Bir template'in her zaman **tek bir güncel** değişken kümesi vardır. Manifest'in **geçmiş versiyonları saklanmaz, karşılaştırılmaz, listelenmez.** Bu, projenin resmi olarak benimsediği **"Tek Aktif Manifest" (Single Active Manifest)** modelidir.

**Manifest sarf edilebilirdir (disposable):**

- Manifest, bir `.aep` dosyasından **her zaman yeniden üretilebilir** — kalıcı bir kayıt değil, geçici bir ara çıktıdır.
- Laravel, gelen Manifest'i **parse eder** ve `template_variables` tablosuna yazar (§5.6, adım 3) — parse işleminden sonra ham Manifest'in kendisine bir daha **hiçbir zaman** ihtiyaç duyulmaz.
- **Ham Manifest'in kalıcı olarak saklanması opsiyoneldir** ve yalnızca debug/denetim (auditing) amacıyla faydalıdır — bu asla bir mimari gereksinim değildir. Hiçbir bileşen (Laravel, Render Node, ya da gelecekteki başka bir sistem) ham Manifest'in kalıcı olarak saklanmış olmasına **bağımlı olmamalıdır**.
- **Render Node, önceden saklanmış ham bir Manifest'e asla bağımlı olmamalıdır.** Render Node'un ihtiyaç duyduğu Manifest-şeklinde veri (§10, adım `[3]`), Laravel tarafından her seferinde `template_variables` satırlarından **yeniden inşa edilir** (reconstruct) — aynı şemaya (§5.1/§5.2) yeniden serileştirme yeterlidir.
- **Kanonik veri, parse edilmiş `template_variables` satırlarıdır.** Bir sonraki render job'ı için gereken her şey (`key`/`label`/`type`/`defaultValue`/`sortOrder`/`metadata`) oradan okunur.

**Yeni tarama = eski verinin tamamen yerini alması:** Bir template yeniden tarandığında (yeni bir Manifest upload edildiğinde), `TemplateVariableService::syncFromScanResult()` o template'in **tüm** eski `template_variables` satırlarını yeni gelen setle **değiştirir** (artık gelmeyen `key`'ler silinir, gelenler upsert edilir). Ara bir "manifest versiyonu" kavramı **yoktur** — her yeni tarama, bir öncekinin yerini tamamen alır.

**Gerekçe:**

- Gereksiz karmaşıklıktan kaçınma — manifest geçmişi/diff/rollback gibi özellikler ilk sürüm için gerekli değil.
- Mevcut Laravel şeması zaten bu modele göre kurulmuş: `template_variables` tablosunda bir "manifest version" kolonu **yok**.
- Manifest'in kendi `schemaVersion`/envelope `version` alanı (§4) yalnızca **şemanın** (yapının) versiyonunu taşır — bu, saklanan bir "içerik geçmişi" ile karıştırılmamalıdır. Bir template'in Manifest'i her zaman tektir; zaman içinde değişen şey o tek Manifest'in **içeriğidir**, bir sürüm geçmişi değil.

### 11.2 İmplementasyon Gereksinimi: RenderJob Bütünlüğü (Karar 4)

Bu madde önceki revizyonda "bilinen risk" olarak işaretlenmişti — artık **resmi bir implementasyon gereksinimidir**, bir seçenek değil:

> **Platform, bir template yeniden tarandığında geçmiş RenderJob'ların bütünlüğünü (historical RenderJob integrity) korumak ZORUNDADIR.**

**Sorunun kaynağı:** `render_project_variables.template_variable_id` alanı `restrictOnDelete()` ile kısıtlı. Bir template yeniden tarandığında, artık gelmeyen bir `key`'e ait `template_variables` satırı, eğer geçmişte bir `render_project_variables` kaydı ondan değer almışsa, bugünkü şemayla **silinemez** ve işlem DB seviyesinde hata verir. §3'teki `Ready → WaitingManifest → Ready` (yeniden tarama) geçişi artık state machine'in **normal, beklenen bir parçası** olduğu için, bu senaryo nadir bir edge case değil, **düzenli olarak tetiklenecek bir gerçek akıştır.**

**Bu doküman kesin implementasyon stratejisini tanımlamaz.** Soft delete, "artık aktif değil" bayrağı veya başka bir yaklaşım — hangisinin kullanılacağı bilinçli olarak **implementasyon fazına** bırakılmıştır (§14). Ancak gereksinimin kendisi zorunludur: implementasyon fazı bu sorunu çözmeden `template_variables` senkronizasyonu (§5.6) production'a alınamaz.

---

## 12. Hata Yönetimi ve Doğrulama Kuralları

| Kural                                                                    | Sonuç                                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Registration Token geçersiz / süresi geçmiş / daha önce kullanılmış (§2) | Manifest Upload reddedilir; Scanner render-ayarları adımlarına hiç geçmez (§9).                                |
| Envelope `schema` beklenenle eşleşmiyor                                  | Nesne reddedilir.                                                                                              |
| Envelope `version` majör olarak uyumsuz                                  | Nesne reddedilir.                                                                                              |
| `TemplateVariable.type` bilinen bir `VariableType` değil                 | O değişken reddedilir (job hiç Adobe'ye gönderilmeden, en erken noktada).                                      |
| `metadata.compositionName` / `metadata.layerName` eksik                  | O değişken reddedilir (adres çözümlenemez).                                                                    |
| Medya-olmayan bir tip için `metadata.propertyPath` boş                   | O değişken reddedilir.                                                                                         |
| Composition/Layer/Property bulunamadı (§6)                               | O değişken **başarısız** sayılır; render devam eder ama **job sonunda bir bütün olarak başarısız** raporlanır. |
| `variables.json`'da bir zorunlu `key` eksik ve `defaultValue` da yok     | Job, Adobe'ye hiç gönderilmeden reddedilir.                                                                    |

**Genel ilke:** Sessiz geçiş yoktur. Her reddetme/başarısızlık, hangi `key`/hangi sebep olduğunu açıkça taşıyan bir hata olarak raporlanır.

---

## 13. Kapsam Dışı (v1'de ele alınmayan, bilinçli olarak ertelenen)

- **Laravel↔Render Node gerçek API implementasyonu** (route'lar, controller'lar, authentication, Registration Token'ın Laravel-içi saklama/expiry mekanizması). Bu doküman sözleşmeyi (Registration Token kavramı — §2, Manifest Upload payload şekli — §5.6) tanımlar; **route/controller implementasyonunun kendisi** ayrı bir faz (bkz. §14).
- **Registration Token'ın kalıcı veri modeli** (hangi tabloda tutulur, expiry süresi tam olarak ne kadar vb.) — §2.6 token'ın durum makinesini (`Generated`/`Validated`/`Consumed`/`Expired`/`Revoked`) tanımlar, ama bu durumların Laravel'de hangi tabloda/hangi somut expiry politikasıyla saklanacağı implementasyon fazında (Faz 1, §14) netleştirilir.
- **Template State Machine'in Laravel-içi implementasyonu** (geçiş guard'ları, event/listener yapısı, admin panel entegrasyonu) — §3 yalnızca mimari durum/geçiş sözleşmesini tanımlar.
- **RenderJob bütünlüğü stratejisinin kesin implementasyonu** (soft delete / "artık aktif değil" bayrağı / başka bir yöntem) — §11.2'de bir GEREKSİNİM olarak tanımlandı, ama hangi tekniğin kullanılacağı implementasyon fazına bırakıldı.
- **Manifest geçmişi/versiyon karşılaştırma** — bkz. §11.
- **IMAGE/VIDEO/AUDIO/DROPDOWN tiplerinin Scanner tarafından üretilmesi** — bugün bu tipler yalnızca elle hazırlanmış manifestlerde var; gerçek bir keşif mekanizmaları yok.
- **`TemplateVariable.defaultValue`'nun Render Node TypeScript tarafındaki `string \| null` tip tanımının gerçek (çok tipli) davranışa göre genişletilmesi** — JSON seviyesinde sorun yok, sadece TS tipi eksik.
- **Birden fazla Scanner motoru** (bugün yalnızca After Effects/Essential Graphics).
- **Render profili dışında dinamik renderer ayarları** (bugün yalnızca `requiresAlpha` → sabit bir `alpha` profiline geçiş var; gelecekte codec/çözünürlük gibi başka job-bazlı ayarlar gerekebilir).

---

## 14. Uygulama Yol Haritası

Bu doküman onaylandıktan sonra, implementasyon aşağıdaki fazlarda ilerler. Her faz, bir öncekinin gerçek, çalışan bir sonucu üzerine kurulur — hiçbir faz varsayımsal bir sonraki faza dayanmaz.

| Faz       | Kapsam                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Faz 0** | Teknik Şartname (bu doküman).                                                                                                                                                                                                                                    |
| **Faz 1** | Registration API (Registration Token üretimi/doğrulanması/tüketilmesi — §2) + Template/Token durum makinelerinin implementasyonu (§3, §2.6) + Manifest Upload API (§5.6, `template_variables` senkronizasyonu, §11.2'deki RenderJob bütünlük gereksinimi dahil). |
| **Faz 2** | Render Job API (Laravel'in `render_project_variables`'tan bir RenderJob — §5.5 — kurup Render Node'a dispatch etmesi).                                                                                                                                           |
| **Faz 3** | Render Worker API (Render Node'un job'ı gerçek zamanlı alması, ilerleme/sonuç bildirimi — bugünkü `pratiktools-render-node` implementasyonunun geri kalan uçları).                                                                                               |
| **Faz 4** | İzleme / Ölçeklendirme (çoklu Render Node, kuyruk sağlığı, gözlemlenebilirlik).                                                                                                                                                                                  |

Her fazın kendi teknik detayları (route'lar, controller'lar, migration'lar) bu dokümanın kapsamı dışındadır — bu doküman yalnızca fazlar arasındaki **veri sözleşmesinin** değişmeyeceğini garanti eder.

---

## Ek A: Gerçek Referans Dosyalar

- **Scanner referansı:** `generate_manifest.jsx` (Essential Graphics keşfi + admin onay diyaloğu + Manifest üretimi).
- **Apply referansı:** `apply_manifest.jsx` (Property Çözümleme Algoritması'nın §6'daki tanımının kaynağı).
- **Render Node Contract tanımları:** `pratiktools-render-node/src/contracts/manifest.contract.ts`, `template-variable.contract.ts`, `render-job.contract.ts`, `contract-envelope.ts`.
- **Render Node davranışsal implementasyonu:** `pratiktools-render-node/src/jsx/apply-variables.jsx` (`PropertyResolver`), `src/jsx/variable-resolver.ts`.
- **Laravel DB şeması:** `pratiktools-site/database/migrations/2026_07_25_000001_create_template_variables_table.php`, `..._000003_create_render_project_variables_table.php`, `app/Services/CloudRendering/TemplateVariableService.php`.
- **Laravel Template durum enum'u:** `pratiktools-site/app/Enums/CloudRenderStatus.php` (§3'ün temel aldığı gerçek enum).
- **Ayrıntılı alan-bazlı referans:** `pratiktools-render-node/docs/scanner-manifest-metadata-contract.md` (bu doküman onu genişletir/bütünler, çelişmez).

**Not:** Registration Token doğrulaması, Template/Token durum makineleri ve Manifest Upload akışı (§2, §3, §5.6, §9) bu revizyon itibarıyla henüz `generate_manifest.jsx`'e veya Laravel tarafına eklenmemiştir — Faz 1 kapsamında (§14) hem Scanner referansına hem Laravel'e gerçek implementasyon olarak eklenecektir.
