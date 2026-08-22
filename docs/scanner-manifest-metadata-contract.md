# Scanner ↔ Render Node Metadata Sözleşmesi (Kanonik Referans)

Bu doküman, `ManifestContract`'ın (`TemplateVariableContract[]`) her bir öğesindeki serbest-form `metadata: Record<string, unknown> | null` alanının Scanner tarafından **nasıl üretildiğini** ve Render Node tarafından **nasıl tüketildiğini** tanımlar. `ManifestContract`/`TemplateVariableContract`'ın kendisi (Contract şeması) burada tanımlanmadı ve değişmedi — bu doküman yalnızca o Contract'ın içindeki, şema dışı `metadata` bagının davranışsal sözleşmesini belgeler.

**Statü (Faz 8C):** Bu sözleşme, kullanıcının paylaştığı gerçek üretim referans dosyalarının (`generate_manifest.jsx`, `apply_manifest.jsx`, örnek `manifest.json`/`manifest_modified.json`) davranışını **birebir** yansıtacak şekilde tasarlandı. Bu referans dosyalar artık projenin resmi davranışsal spesifikasyonu kabul ediliyor: Render Node'un kendi iç implementasyonu (`PropertyResolver`, `apply-variables.jsx`) daha modüler/temiz olabilir, ama gözlemlenebilir davranış (hangi property'nin hangi girdilerle bulunacağı, fallback sırası) bu referanslarla uyumlu kalmalıdır.

---

## 1. Neden Essential Graphics'in kendisi değil de bir adres taşınıyor

Gerçek üretim sisteminde değişken KEŞFİ, Essential Graphics (EGP) üzerinden yapılıyor: Scanner, published EGP controller'larının arkasındaki gerçek property'leri `essentialPropertySource` + geçici bir sandbox comp'a nesting tekniğiyle çözüyor (bkz. `docs/adobe-platform-constraints.md` §4). Ama bu keşif işlemi tamamen Scanner'ın sorumluluğunda — Render Node, manifest'e ulaştığında Essential Graphics'e hiç dokunmaz ve dokunmamalıdır:

- Render Node'un çalıştığı gerçek AE sürümünde `comp.motionGraphicsTemplateController(index)` gibi bir API yok (Faz 8A'da doğrulandı) — Render Node'un EGP'yi runtime'da yeniden çözmesi için gerçek bir mekanizma yok.
- Aynı işi iki kez yapmak (Scanner'ın keşfettiğini Render Node'un tekrar keşfetmesi) gereksiz ve kırılgan.

Bunun yerine Scanner, keşfettiği her değişken için gerçek AE adresini (`compositionName`+`layerName`+`propertyPath`, opsiyonel `matchName`) manifest'in `metadata` alanına yazıyor; Render Node bu adresi kullanarak standart, her zaman mevcut olan layer/property-tree gezintisiyle gerçek `Property` nesnesine ulaşıyor.

---

## 2. `metadata` alanları

Her `TemplateVariableContract.metadata` nesnesi (medya olmayan tipler için):

| Alan                | Tip        | Zorunlu mu                                          | Açıklama                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compositionName`   | `string`   | **Evet**                                            | Property'nin gerçekten yaşadığı composition'ın adı. Zorunlu: farklı composition'larda aynı isimli layer'lar olabilir; compositionName olmadan bu ayrım imkânsız.                                                                                                                                             |
| `layerName`         | `string`   | **Evet**                                            | `compositionName` içindeki layer'ın adı.                                                                                                                                                                                                                                                                     |
| `propertyPath`      | `string[]` | Medya olmayan tipler için **Evet** (en az 1 eleman) | Layer'dan property'ye giden görünen-ad zinciri, örn. `["Effects", "Tracking Amount", "Slider"]`. Referans (`apply_manifest.jsx`) bunu `/`-ayrılmış bir string olarak taşıyor; Render Node'da bilinçli olarak bir **dizi** — ayrıştırma gerektirmiyor ve isminde `/` geçen property'leri güvenle destekliyor. |
| `propertyMatchName` | `string`   | Hayır (opsiyonel)                                   | Property'nin locale-bağımsız `matchName`'i, örn. `"ADBE Checkbox Control-0001"`. Sadece `propertyPath` gezintisi başarısız olduğunda fallback için kullanılır.                                                                                                                                               |

IMAGE/VIDEO/AUDIO tipleri için `propertyPath` boş dizi (`[]`) olabilir — bu tipler bir property'ye değil, doğrudan layer'ın kendisine (`ReplaceSource` ile) bağlanır; ama `compositionName`+`layerName` bu tipler için de zorunludur (layer'ı bulmak için).

`ae.property` (referans manifest şemasındaki leaf display-name alanı) her zaman `propertyPath`'in SON elemanına eşittir — bu, referans örnek manifestlerinde (`manifest.json`) doğrulanmış bir değişmezdir ve Render Node'un fallback aramasında "tercih edilen tam eşleşme" olarak kullanılır (bkz. §3).

---

## 3. Çözümleme sırası (Composition → Layer → PropertyPath → matchName → displayName → ilk uyumlu eşleşme)

Hem gerçek üretim referansı (`apply_manifest.jsx`) hem de Render Node'un `PropertyResolver`'ı (`src/jsx/apply-variables.jsx`) aynı sırayı izler:

1. **Composition çözümü:** `compositionName` ile projedeki `CompItem`'lar arasında ada göre ara (cache'li). Bulunamazsa çözümleme başarısız.
2. **Layer çözümü:** Bulunan composition İÇİNDE `layerName` ile ara (cache, composition'a göre scoped — başka composition'daki aynı isimli layer asla karışmaz).
3. **PropertyPath gezintisi (birincil):** `layer.property(propertyPath[0]).property(propertyPath[1])...` — her adım görünen ada göre. Zincirin herhangi bir adımı `null`/hata verirse (fail-soft, exception yutulur) adım 4'e geç.
4. **matchName + displayName fallback (ikincil, yalnızca `propertyMatchName` mevcutsa):** Layer'ın TÜM property ağacı recursive gezilir (klasörler `INDEXED_GROUP`/`NAMED_GROUP`, yapraklar `PROPERTY`). `matchName === propertyMatchName` olan her property adaydır:
   - `prop.name` (görünen ad) `propertyPath`'in SON elemanına tam eşitse → **kesin eşleşme**, arama biter, bu döndürülür.
   - Aksi halde → **ilk matchName-only eşleşme** hatırlanır (fallback).
   - Ağacın tamamı gezilip kesin eşleşme hiç bulunamazsa, hatırlanan ilk matchName-only eşleşme döndürülür.
5. Hiçbiri bulunamazsa → `PROPERTY_NOT_FOUND` (Render Node bunu değişken bazında `failedCount`'a ekler, tüm çalışmayı durdurmaz).

Bu sıra, indexed-group içindeki (Effects, Masks gibi) aynı `matchName`'i paylaşan birden fazla örneği (örn. iki "Checkbox Control" effect'i) `propertyPath`'teki gerçek görünen ad ile ayırt edebiliyor, ama `propertyPath` bir noktada bozulursa (örn. bir effect yeniden adlandırılmışsa) yine de `matchName` üzerinden makul bir sonuca düşebiliyor — üretimde zaten doğrulanmış bu davranış korunuyor.

---

## 4. Kim üretiyor, kim tüketiyor

- **Scanner** (bu repo'nun DIŞINDA, ayrı bir sistem — `generate_manifest.jsx` üretim referansı): Essential Graphics'i sandbox-comp-nesting tekniğiyle okur, her keşfedilen değişken için `compositionName`/`layerName`/`propertyPath`(+`matchName`) hesaplar, `ManifestContract.variables[].metadata`'ya yazar. `compositionName|layerName|propertyPath` üçlüsüyle deduplicate eder (aynı property birden fazla nesting seviyesinden yeniden expose edilebildiği için).
- **Render Node** (bu repo): `VariableResolver` (`src/jsx/variable-resolver.ts`) bu alanları `metadata`'dan çıkarır ve doğrular (`compositionName`/`layerName` eksikse, medya olmayan tipler için `propertyPath` boşsa → `PropertyAddressResolutionError`, herhangi bir Adobe round-trip'inden ÖNCE). `PropertyResolver` (`src/jsx/apply-variables.jsx`) yukarıdaki §3 sırasıyla gerçek `Property` nesnesine ulaşır. `AssetImporter` (`src/jsx/asset-importer.jsx`) IMAGE/VIDEO/AUDIO için aynı şekilde `compositionName`+`layerName` ile scoped layer arar.

---

## 5. Versiyonlama

`ManifestContract.schemaVersion` zaten manifest'in İÇ yapısının (bu `metadata` sözleşmesi dahil) versiyonunu taşımak için var — ayrı bir `manifestVersion` alanına gerek yok. Bu sözleşmede geriye dönük uyumsuz bir değişiklik (örn. `compositionName`'in zorunlu hale gelmesi gibi) yapılırsa `schemaVersion` artırılmalı ve bu doküman güncellenmelidir.

---

## 6. İlgili dokümanlar

- `docs/adobe-platform-constraints.md` §4 — Essential Graphics'in gerçek okuma mekanizması (Scanner tarafı, bu repo'nun dışında ama bağlam için belgelendi).
- `docs/phase-8a-adobe-variable-engine-and-render.md` — Variable Engine'in genel mimarisi ve Faz 8A'nın gerçek test bulguları.
