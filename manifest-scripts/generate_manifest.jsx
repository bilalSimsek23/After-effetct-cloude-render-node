#target aftereffects

    /**
     * ExtendScript: After Effects Essential Graphics Manifest Generator
     *
     * Target: Adobe After Effects CC 2022 (22.0) and higher.
     * Description: Scans the open project's compositions to identify published Essential Graphics
     *              controls and writes a manifest.json to the Desktop in the
     *              pratiktools-render-node ManifestContract shape (schema/
     *              version/createdAt envelope, key/label/type/sortOrder/
     *              metadata per variable — see
     *              docs/scanner-manifest-metadata-contract.md in that repo).
     *
     * Minimum Supported Versions:
     * - ADBE Layer Overrides: After Effects CC 2018 (15.1)+
     * - essentialPropertySource: After Effects CC 2022 (22.0)+
     */

    (function () {

        // pratiktools-render-node'un ManifestContract'ı ile ManifestValidator's
        // envelope check'i (schema/version/createdAt) — bkz. contract-envelope.ts.
        // Bu iki sabit, Render Node'un o an desteklediği Contract semver'iyle
        // aynı tutulmalı (bkz. MANIFEST_CONTRACT_VERSION/TEMPLATE_VARIABLE_CONTRACT_VERSION
        // in manifest.contract.ts / template-variable.contract.ts).
        var MANIFEST_CONTRACT_VERSION = "1.0.0";
        var TEMPLATE_VARIABLE_CONTRACT_VERSION = "1.0.0";
        var SCANNER_VERSION = "1.0.0";

        // Laravel'in Manifest Upload endpoint'i (Cloud Render Platform
        // Technical Specification v1.0, §5.6). ExtendScript'in gerçek bir
        // fetch()/XMLHttpRequest'i yok - bu yüzden sistemin kendi curl'ünü
        // system.callSystem() ile çalıştırıyoruz (Adobe script topluluğunda
        // HTTPS istekleri için standart yöntem; ExtendScript'in Socket
        // nesnesi TLS konusunda güvenilir değil).
        var MANIFEST_UPLOAD_URL = "https://motioncurate.com/api/manifest-upload";

        // Start execution
        main();

        /**
         * Main orchestrator for the After Effects environment.
         * Validates AE project, runs the core scanner, structures the manifest,
         * logs statistics, and writes the JSON file.
         */
        function main() {
            log("----------------------------------------");
            log("Essential Graphics Manifest Generator started");

            // 1. Validate if a project is open
            var project = app.project;
            if (!project) {
                alert("Hata: Açık bir After Effects projesi bulunamadı.");
                log("Hata: Proje bulunamadı.");
                return;
            }
            log("Project bulundu: " + (project.file ? project.file.name : "Kaydedilmemiş Proje"));

            // 2. Compatibility check: Target AE CC 2022 (22.0)+ for essentialPropertySource
            var aeVersionString = app.version || "";
            log("Raw app.version: " + aeVersionString);

            // Extract major version robustly
            var aeVersionNum = 0;
            if (aeVersionString) {
                var firstPart = aeVersionString.split(".")[0].split(",")[0];
                aeVersionNum = parseInt(firstPart, 10);
            }
            log("Parsed AE Major Version: " + aeVersionNum);

            if (isNaN(aeVersionNum) || aeVersionNum < 22) {
                var errMsg = "Bu script After Effects CC 2022 (22.0) ve üzeri sürümleri gerektirir.\n" +
                    "Mevcut Sürüm: " + aeVersionString + "\n\n" +
                    "Lütfen güncel bir After Effects sürümü kullanın.";
                alert(errMsg);
                log("Hata: Uyumsuz After Effects sürümü (" + aeVersionString + ")");
                return;
            }

            // 3. Scan Essential Graphics variables using the pure engine
            var variables = [];
            var egpPublishedComps = [];
            var numCompsScanned = 0;
            try {
                // Count total compositions for reporting
                for (var i = 1; i <= project.numItems; i++) {
                    if (project.item(i) instanceof CompItem) {
                        numCompsScanned++;
                    }
                }

                // Run pure logic engine
                var scanResult = scanEssentialGraphics();
                variables = scanResult.variables;
                egpPublishedComps = scanResult.egpPublishedComps;
            } catch (e) {
                if (e.message === "essentialPropertySource_unsupported") {
                    var errMsg = "Hata: 'essentialPropertySource' özelliği bu After Effects sürümünde desteklenmiyor.\n" +
                        "Bu script After Effects CC 2022 (22.0) ve üzeri sürümleri gerektirir.";
                    alert(errMsg);
                    log(errMsg);
                } else {
                    var errMsg = "Tarama sırasında beklenmeyen bir hata oluştu:\n" + e.message;
                    alert(errMsg);
                    log("Hata: " + e.toString());
                }
                return;
            }

            // 3b. Render hedefi comp'u belirle - manifest'in kendisi HİÇBİR
            // değişkenin metadata.compositionName'inde bu bilgiyi taşımaz
            // (o alan sadece o değişkenin property'sinin fiziksel olarak
            // yaşadığı comp'u gösterir, render edilecek "ana/final" comp
            // farklı olabilir). Gerçek proje kuralı: önce "Final Comp"
            // adını içeren bir composition aranır (proje klasör yapısı:
            // "02.Final Comp" klasörü içinde "Final Comp" adlı comp); yoksa
            // Essential Graphics'in yayınlandığı comp'a düşülür.
            var renderComposition = findFinalComposition();
            var renderCompositionSource = renderComposition ? "final-comp-name" : null;
            if (!renderComposition) {
                if (egpPublishedComps.length === 1) {
                    renderComposition = egpPublishedComps[0];
                    renderCompositionSource = "essential-graphics-comp";
                } else if (egpPublishedComps.length > 1) {
                    renderComposition = egpPublishedComps[0];
                    renderCompositionSource = "essential-graphics-comp-ambiguous";
                    log("UYARI: Essential Graphics birden fazla comp'ta yayınlanmış bulundu (" +
                        egpPublishedComps.join(", ") + ") - ilki seçildi: " + renderComposition);
                } else {
                    renderCompositionSource = "none-found";
                    log("UYARI: Ne 'Final Comp' adında bir composition ne de Essential Graphics " +
                        "yayınlanmış bir comp bulunamadı - renderComposition boş bırakıldı.");
                }
            }
            log("Render hedefi composition (otomatik tespit): " + (renderComposition || "BULUNAMADI") +
                " (kaynak: " + renderCompositionSource + ")");

            // 3c. Otomatik tespit sadece bir ÖN SEÇİM - render composition,
            // alpha ihtiyacı ve render süresi gibi soruların hiçbiri AE
            // scripting'den %100 güvenilir çıkarılamaz (özellikle alpha,
            // teknik değil kreatif bir karar). Bu yüzden manifest yazılmadan
            // ÖNCE gerçek bir ScriptUI diyaloğu açılıp admin'e soruluyor -
            // ileride başka sorular çıkarsa aynı diyaloğa yeni alan eklemek
            // yeterli (bkz. showManifestOptionsDialog()).
            var allCompNames = getAllCompositionNames();
            if (allCompNames.length === 0) {
                alert("Hata: Projede hiç composition bulunamadı.");
                log("Hata: Projede hiç composition yok, diyalog açılamadı.");
                return;
            }

            var defaultDuration = renderComposition
                ? getCompositionWorkAreaDuration(renderComposition)
                : getCompositionWorkAreaDuration(allCompNames[0]);

            var dialogAnswers = showManifestOptionsDialog(
                allCompNames,
                renderComposition || allCompNames[0],
                defaultDuration
            );

            if (!dialogAnswers) {
                log("Kullanıcı iptal etti - manifest.json oluşturulmadı.");
                alert("İşlem iptal edildi. manifest.json oluşturulmadı.");
                return;
            }

            var registrationToken = dialogAnswers.registrationToken;
            renderComposition = dialogAnswers.renderComposition;
            var requiresAlpha = dialogAnswers.requiresAlpha;
            var renderDurationSeconds = dialogAnswers.renderDurationSeconds;

            log("Render ayarları (admin onaylı): composition=" + renderComposition +
                " requiresAlpha=" + requiresAlpha + " renderDurationSeconds=" + renderDurationSeconds);

            // 3d. Erken, yerel doğrulama - Laravel'in ManifestValidator'ının
            // reddedeceği eksik alanları (özellikle metadata.layerName/
            // compositionName null kalması, medya slotlarında sık görülen
            // bir AE nesne-modeli tuhaflığı) buradan, yüklemeye kalkmadan
            // önce göster - böylece kullanıcı MANIFEST_VARIABLE_INVALID
            // gibi genel bir hata koduyla değil, hangi değişkenin ve hangi
            // alanın eksik olduğuyla karşılaşır.
            var localValidationWarnings = validateVariablesLocally(variables);
            if (localValidationWarnings.length > 0) {
                log("UYARI: " + localValidationWarnings.length + " değişkende yerel doğrulama sorunu var:");
                for (var w = 0; w < localValidationWarnings.length; w++) {
                    log("  - " + localValidationWarnings[w]);
                }
            }

            // 4. Wrap variables in the pratiktools-render-node ManifestContract
            // shape: a Contract envelope (schema/version/createdAt — every
            // payload that crosses the Scanner->Render Node boundary carries
            // this, see contract-envelope.ts) plus the Manifest's own payload
            // fields (schemaVersion/scannerVersion/engine/variables/metadata).
            var manifest = {
                "schema": "manifest",
                "version": MANIFEST_CONTRACT_VERSION,
                "createdAt": nowIso(),
                "schemaVersion": "1.0.0",
                "scannerVersion": SCANNER_VERSION,
                "engine": "after-effects",
                "variables": variables,
                "metadata": {
                    "renderComposition": renderComposition,
                    "requiresAlpha": requiresAlpha,
                    "renderDurationSeconds": renderDurationSeconds
                }
            };

            // Serialize output cleanly
            var jsonString = objectToJsonString(manifest);

            // 5. Determine the Desktop path
            var desktopPath = Folder.desktop.fsName;
            var separator = ($.os.indexOf("Windows") !== -1) ? "\\" : "/";
            var outputFilePath = desktopPath + separator + "manifest.json";

            // 6. Write to Desktop
            var writeResult = writeTextFile(outputFilePath, jsonString);

            if (writeResult.success) {
                log("Composition sayısı: " + numCompsScanned);
                log("Essential Graphics sayısı: " + variables.length);
                log("Oluşturulan JSON yolu: " + outputFilePath);

                var localSummary = "Dosya: " + outputFilePath +
                    "\nBulunan değişken sayısı: " + variables.length +
                    "\nRender hedefi: " + renderComposition +
                    "\nAlpha gerekli: " + requiresAlpha +
                    "\nRender süresi: " + renderDurationSeconds + " sn";

                if (localValidationWarnings.length > 0) {
                    localSummary += "\n\n⚠ YEREL DOĞRULAMA UYARISI (" + localValidationWarnings.length +
                        " değişken) - MotionCurate'a yüklense bile muhtemelen reddedilecek:\n  - " +
                        localValidationWarnings.join("\n  - ");
                }

                if (!registrationToken) {
                    // Token girilmedi - eski (yalnızca yerel) davranış.
                    alert("Manifest başarıyla masaüstüne kaydedildi!\n\n" + localSummary +
                        "\n\nNot: Registration Token girilmediği için MotionCurate'a " +
                        "otomatik gönderilmedi - manuel yüklemeniz gerekecek.");
                } else {
                    log("MotionCurate'a yükleniyor (token girildi)...");
                    var uploadResult = uploadManifestToLaravel(registrationToken, jsonString);

                    if (uploadResult.success) {
                        log("Yükleme başarılı: " + uploadResult.message);
                        alert(
                            "Manifest başarıyla MotionCurate'a yüklendi!\n\n" + localSummary +
                            "\n\nSunucu yanıtı: " + uploadResult.message +
                            (uploadResult.syncedVariableCount !== null
                                ? "\nSenkronize edilen değişken sayısı: " + uploadResult.syncedVariableCount
                                : "") +
                            "\n\n→ ÖNEMLİ - SONRAKİ ADIM:\n" +
                            "Lütfen .mogrt dosyasını web sitesindeki ürün sayfasında " +
                            "\"Dependency Package\" sekmesinden yüklemeyi UNUTMAYIN - " +
                            "render işleminin gerçekten çalışabilmesi için bu adım da gerekli."
                        );
                    } else {
                        log("Yükleme başarısız: " + uploadResult.message);
                        alert(
                            "Manifest masaüstüne kaydedildi, ANCAK MotionCurate'a yüklenirken " +
                            "bir hata oluştu:\n\n" + uploadResult.message +
                            "\n\n" + localSummary +
                            "\n\nDosya masaüstünde duruyor - token'ı kontrol edip " +
                            "(süresi dolmuş/kullanılmış olabilir) script'i tekrar " +
                            "çalıştırabilir veya manuel curl ile yükleyebilirsiniz."
                        );
                    }
                }
            } else {
                log("Hata: Dosya masaüstüne yazılamadı. Yol: " + outputFilePath + " Neden: " + writeResult.reason);
                alert(
                    "Hata: manifest.json dosyası masaüstüne yazılamadı.\n" +
                    "Yol: " + outputFilePath + "\n" +
                    "Neden: " + writeResult.reason + "\n\n" +
                    "Sık görülen sebep: After Effects > Settings/Preferences > Scripting & " +
                    "Expressions altında \"Allow Scripts to Write Files and Access Network\" " +
                    "kapalı olabilir."
                );
            }
            log("----------------------------------------");
        }

        /**
         * Scans all compositions in the active project and extracts variables published in their Essential Graphics panels.
         * This function has zero file system or JSON-writing dependencies.
         *
         * Minimum Supported Version:
         * - ADBE Layer Overrides: After Effects CC 2018 (15.1)+
         * - essentialPropertySource: After Effects CC 2022 (22.0)+
         * 
         * @returns {{variables: Array, egpPublishedComps: Array}} Extracted
         *   variables plus the distinct list of composition names that
         *   actually had a non-empty "ADBE Layer Overrides" group (i.e.
         *   Essential Graphics published directly on them) - used as the
         *   render-target fallback when no "Final Comp"-named composition
         *   exists (see findFinalComposition()/main()).
         * @throws {Error} If compatible ExtendScript features are missing.
         */
        function scanEssentialGraphics() {
            var variables = [];
            var egpPublishedComps = [];
            // Same physical property can surface more than once if it was re-exposed
            // through multiple nesting levels - track composition|layer|property|matchName
            // tuples already recorded so each real property is only added once.
            var seen = {};
            var project = app.project;
            if (!project) {
                return { variables: variables, egpPublishedComps: egpPublishedComps };
            }

            // Create a temporary sandbox composition
            var tempCompName = "__EGP_Scanner_Temp_" + new Date().getTime() + "__";
            var tempComp = project.items.addComp(tempCompName, 100, 100, 1, 1, 24);

            try {
                var numItems = project.numItems;
                for (var i = 1; i <= numItems; i++) {
                    var item = project.item(i);

                    // Only scan comps, skipping our temporary sandbox
                    if (item instanceof CompItem && item.name !== tempCompName) {
                        var comp = item;

                        // Nest composition as a temporary layer to read overrides
                        var tempLayer = tempComp.layers.add(comp);

                        // Access Essential Properties
                        // Minimum supported version for ADBE Layer Overrides: 15.1
                        var essentialPropsGroup = tempLayer.property("ADBE Layer Overrides");

                        if (essentialPropsGroup && essentialPropsGroup.numProperties > 0) {
                            collectEssentialProperties(essentialPropsGroup, comp, variables, seen);
                            if (indexOfString(egpPublishedComps, comp.name) === -1) {
                                egpPublishedComps.push(comp.name);
                            }
                        }

                        // Remove the nested layer to keep sandbox clean
                        tempLayer.remove();
                    }
                }
            } finally {
                // Clean up temp comp in all scenarios
                if (tempComp) {
                    tempComp.remove();
                }
            }

            return { variables: variables, egpPublishedComps: egpPublishedComps };
        }

        /**
         * Finds a composition whose name matches the real project's "Final
         * Comp" naming convention (case-insensitive substring match, so
         * numeric folder-style prefixes like "02.Final Comp" or suffixes
         * like "Final Comp_v2" still match) - this is the actual render
         * target in projects that follow this convention, independent of
         * which comp Essential Graphics happens to be published on.
         *
         * @returns {string|null} The real composition name, or null if none found.
         */
        function findFinalComposition() {
            var project = app.project;
            for (var i = 1; i <= project.numItems; i++) {
                var item = project.item(i);
                if (item instanceof CompItem) {
                    if (item.name.toLowerCase().indexOf("final comp") !== -1) {
                        return item.name;
                    }
                }
            }
            return null;
        }

        /**
         * @returns {Array} Names of every real composition in the project (flat, folder-independent).
         */
        function getAllCompositionNames() {
            var names = [];
            var project = app.project;
            for (var i = 1; i <= project.numItems; i++) {
                var item = project.item(i);
                if (item instanceof CompItem) {
                    names.push(item.name);
                }
            }
            return names;
        }

        /**
         * @param {string} compName - Composition name to look up.
         * @returns {number|null} That composition's current work area duration (seconds), or null if not found.
         */
        function getCompositionWorkAreaDuration(compName) {
            var project = app.project;
            for (var i = 1; i <= project.numItems; i++) {
                var item = project.item(i);
                if (item instanceof CompItem && item.name === compName) {
                    return item.workAreaDuration;
                }
            }
            return null;
        }

        /**
         * Real ScriptUI dialog shown before manifest.json is written -
         * render composition, alpha requirement and render duration are
         * never assumed; the operator confirms or overrides each one here.
         * Extending this later (new questions) means adding one more
         * control to this same dialog, not building a new mechanism.
         *
         * @param {Array} allCompNames - Every real composition name in the project (dropdown choices).
         * @param {string} defaultComposition - Pre-selected composition (auto-detected "Final Comp"/EGP fallback).
         * @param {number|null} defaultDurationSeconds - Pre-filled duration, from defaultComposition's work area.
         * @returns {{registrationToken: string, renderComposition: string, requiresAlpha: boolean, renderDurationSeconds: number}|null}
         *   Answers, or null if the operator cancelled (manifest.json must NOT be written in that case).
         */
        function showManifestOptionsDialog(allCompNames, defaultComposition, defaultDurationSeconds) {
            var dialog = new Window("dialog", "Manifest Ayarları");
            dialog.orientation = "column";
            dialog.alignChildren = ["fill", "top"];
            dialog.margins = 16;
            dialog.spacing = 10;

            dialog.add("statictext", undefined,
                "Render için kullanılacak ayarları onaylayın veya değiştirin:");

            // Registration Token - Cloud Render Platform Technical
            // Specification v1.0, §9 "Scanner UI Akışı". Admin bunu
            // MotionCurate Review sayfasında "Registration Token Üret"
            // butonundan alır. Boş bırakılırsa manifest yalnızca yerel
            // diske (Desktop) yazılır, Laravel'e gönderilmez - script eski
            // (yalnızca-yerel) davranışıyla da tam uyumlu kalır.
            var tokenGroup = dialog.add("panel", undefined, "MotionCurate Bağlantısı");
            tokenGroup.orientation = "column";
            tokenGroup.alignChildren = ["fill", "top"];
            tokenGroup.margins = 12;
            tokenGroup.add("statictext", undefined,
                "Registration Token (Review sayfasından \"Registration Token Üret\" ile alın):");
            var tokenInput = tokenGroup.add("edittext", undefined, "");
            tokenInput.preferredSize.width = 380;
            tokenGroup.add("statictext", undefined,
                "Boş bırakırsanız manifest yalnızca masaüstüne kaydedilir, MotionCurate'a gönderilmez.");

            var compGroup = dialog.add("group");
            compGroup.orientation = "row";
            compGroup.add("statictext", undefined, "Render Composition:").preferredSize.width = 150;
            var compDropdown = compGroup.add("dropdownlist", undefined, allCompNames);
            compDropdown.preferredSize.width = 220;
            compDropdown.selection = 0;
            for (var i = 0; i < allCompNames.length; i++) {
                if (allCompNames[i] === defaultComposition) {
                    compDropdown.selection = i;
                    break;
                }
            }

            var durationGroup = dialog.add("group");
            durationGroup.orientation = "row";
            durationGroup.add("statictext", undefined, "Render süresi (saniye):").preferredSize.width = 150;
            var durationInput = durationGroup.add(
                "edittext",
                undefined,
                String(defaultDurationSeconds !== null ? defaultDurationSeconds : "")
            );
            durationInput.preferredSize.width = 220;

            // Composition seçimi değişince süre önerisini de o comp'un
            // gerçek work area'sına göre güncelle - kullanıcı yine elle
            // değiştirebilir, bu sadece daha isabetli bir başlangıç değeri.
            compDropdown.onChange = function () {
                if (compDropdown.selection) {
                    var newDuration = getCompositionWorkAreaDuration(compDropdown.selection.text);
                    if (newDuration !== null) {
                        durationInput.text = String(newDuration);
                    }
                }
            };

            var alphaCheckbox = dialog.add(
                "checkbox",
                undefined,
                "Şeffaf arka plan (alpha) gerektirir"
            );
            alphaCheckbox.value = false;

            var buttonGroup = dialog.add("group");
            buttonGroup.orientation = "row";
            buttonGroup.alignment = "right";
            var cancelButton = buttonGroup.add("button", undefined, "İptal");
            var okButton = buttonGroup.add("button", undefined, "Tamam");

            var answers = null;

            okButton.onClick = function () {
                var parsedDuration = parseFloat(durationInput.text);
                answers = {
                    registrationToken: trimString(tokenInput.text),
                    renderComposition: compDropdown.selection
                        ? compDropdown.selection.text
                        : defaultComposition,
                    requiresAlpha: alphaCheckbox.value,
                    renderDurationSeconds: isNaN(parsedDuration)
                        ? defaultDurationSeconds
                        : parsedDuration
                };
                dialog.close();
            };

            cancelButton.onClick = function () {
                answers = null;
                dialog.close();
            };

            dialog.center();
            dialog.show();

            return answers;
        }

        /**
         * ES3-safe Array.indexOf substitute for strings - this ExtendScript
         * engine's real Array method support is not guaranteed (see nowIso()'s
         * own note on the same concern), so a manual loop is used instead of
         * assuming Array.prototype.indexOf exists.
         *
         * @param {Array} arr - Array of strings to search.
         * @param {string} value - Value to find.
         * @returns {number} Index of value in arr, or -1 if not found.
         */
        function indexOfString(arr, value) {
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] === value) {
                    return i;
                }
            }
            return -1;
        }

        /**
         * ES3-safe String.trim() substitute - same rationale as
         * indexOfString()/nowIso() above (this ExtendScript engine's real
         * String/Array method support is not guaranteed).
         *
         * @param {string} str
         * @returns {string}
         */
        function trimString(str) {
            if (!str) {
                return "";
            }
            return String(str).replace(/^\s+|\s+$/g, "");
        }

        /**
         * Recursively walks an "ADBE Layer Overrides" property group, descending into
         * organizational folders/sections created in the Essential Graphics panel.
         * Only leaf properties (PropertyType.PROPERTY) carry essentialPropertySource;
         * folders are plain PropertyGroups and must be recursed into instead of read directly.
         *
         * @param {PropertyGroup} group - Group to scan (top-level overrides group or a nested folder).
         * @param {CompItem} comp - The composition currently being scanned (for ae.composition/id).
         * @param {Array} variables - Accumulator array to push discovered variables into.
         * @param {Object} seen - Dedupe map of composition|layer|property|matchName tuples already recorded.
         * @throws {Error} If essentialPropertySource is missing on a leaf property.
         */
        function collectEssentialProperties(group, comp, variables, seen) {
            for (var p = 1; p <= group.numProperties; p++) {
                var prop = group.property(p);

                if (prop.propertyType !== PropertyType.PROPERTY) {
                    // Folder/section created in the Essential Graphics panel - descend into it
                    collectEssentialProperties(prop, comp, variables, seen);
                    continue;
                }

                // Compatibility check on the actual property instance (AE CC 2022 / 22.0+)
                if (typeof prop.essentialPropertySource === "undefined") {
                    throw new Error("essentialPropertySource_unsupported");
                }

                // Reference the master property inside the source composition
                var sourceProp = prop.essentialPropertySource;
                if (!sourceProp) {
                    continue;
                }

                // Resolve details
                var sourceLayerObj = getSourceLayer(sourceProp);
                var sourceLayerName = sourceLayerObj ? sourceLayerObj.name : null;
                // The layer may physically live inside a different (nested) comp than the
                // one currently being scanned, if this property was re-exposed through it.
                // Use the layer's own containing comp so composition/layer always form a
                // valid, directly resolvable parent-child pair for the apply-side script.
                var sourceCompName = (sourceLayerObj && sourceLayerObj.containingComp) ? sourceLayerObj.containingComp.name : comp.name;

                // sourceProp.name/matchName alone are too generic to identify a specific
                // property (e.g. every Slider Control's leaf property is named "Slider" with
                // matchName "ADBE Slider Control-0001") - the full property path (effect/group
                // names up to the layer) is what actually distinguishes sibling same-type
                // controls, both for dedup here and for precise lookup in the apply script.
                var propertyPath = getPropertyPath(sourceProp);

                // Skip if this exact physical property was already recorded via another
                // nesting/re-exposure path
                var dedupeKey = sourceCompName + "|" + sourceLayerName + "|" + propertyPath;
                if (seen[dedupeKey]) {
                    continue;
                }
                seen[dedupeKey] = true;

                // A layer's Source dragged into Essential Graphics (media/footage
                // replacement slot, e.g. a logo/image the panel exposes for
                // swapping) surfaces with matchName "ADBE Layer Source Alternate"
                // and propertyValueType NO_VALUE - reading .value on it throws
                // ("Can not get or set a value from this property") rather than
                // returning null like a normal empty property would. This is a
                // real IMAGE/VIDEO/AUDIO variable (buyer-uploadable, pratiktools-
                // render-node's AssetImporter/apply-variables.jsx already applies
                // it) - detectMediaType() reads the actual footage to tell which,
                // defaultValue is always null (buyer-optional: leaving it unset
                // means the original embedded asset renders unchanged).
                if (sourceProp.propertyValueType === PropertyValueType.NO_VALUE
                    || prop.propertyValueType === PropertyValueType.NO_VALUE) {
                    var mediaType = detectMediaType(sourceLayerObj);
                    // Only IMAGE/VIDEO slots have a meaningful native pixel
                    // size to report - AUDIO never does, and
                    // getSourceDimensions() already returns null for a
                    // non-FootageItem source regardless of type.
                    var sourceDimensions = (mediaType === "IMAGE" || mediaType === "VIDEO")
                        ? getSourceDimensions(sourceLayerObj)
                        : null;
                    var mediaVariableData = {
                        "schema": "template-variable",
                        "version": TEMPLATE_VARIABLE_CONTRACT_VERSION,
                        "createdAt": nowIso(),
                        "key": sourceCompName + "_" + prop.name + "_" + (variables.length + 1),
                        "label": prop.name,
                        "type": mediaType,
                        "defaultValue": null,
                        "sortOrder": variables.length,
                        "metadata": {
                            "compositionName": sourceCompName,
                            "layerName": sourceLayerName,
                            "propertyPath": propertyPath ? propertyPath.split("/") : [],
                            "propertyMatchName": sourceProp.matchName || prop.matchName || null,
                            "width": sourceDimensions ? sourceDimensions.width : null,
                            "height": sourceDimensions ? sourceDimensions.height : null
                        }
                    };
                    variables.push(mediaVariableData);
                    log("Medya değişkeni bulundu: '" + prop.name + "' tip=" + mediaVariableData.type +
                        " comp=" + sourceCompName + " layer=" + sourceLayerName +
                        (sourceDimensions ? " boyut=" + sourceDimensions.width + "x" + sourceDimensions.height : ""));
                    continue;
                }

                var normType = normalizeType(sourceProp);
                var defVal = serializeValue(prop.value, normType);

                // pratiktools-render-node'un TemplateVariableContract şeması:
                // key/label/type/defaultValue/sortOrder + serbest-form metadata
                // (compositionName/layerName/propertyPath[]/propertyMatchName).
                // propertyPath burada dizi olarak taşınıyor (slash-joined
                // string değil) - ayrıştırma gerektirmiyor, "/" içeren
                // property adlarını da güvenle destekliyor. propertyMatchName,
                // sourceProp.matchName'den geliyor - apply_manifest.jsx'te
                // "ae.propertyType" adıyla taşınan ama aslında matchName olan
                // aynı değer (bkz. apply_manifest.jsx satır 95: "var matchName
                // = ae.propertyType;").
                var variableData = {
                    "schema": "template-variable",
                    "version": TEMPLATE_VARIABLE_CONTRACT_VERSION,
                    "createdAt": nowIso(),
                    "key": sourceCompName + "_" + prop.name + "_" + (variables.length + 1),
                    "label": prop.name,
                    "type": normType.toUpperCase(),
                    "defaultValue": defVal,
                    "sortOrder": variables.length,
                    "metadata": {
                        "compositionName": sourceCompName,
                        "layerName": sourceLayerName,
                        "propertyPath": propertyPath ? propertyPath.split("/") : [],
                        "propertyMatchName": sourceProp.matchName || null
                    }
                };

                variables.push(variableData);
            }
        }

        /**
         * Maps After Effects property matchNames/types to web-ready normalized types.
         *
         * @param {Property} prop - The source After Effects Property object.
         * @returns {string} Normalized type ("text", "number", "color", "boolean", "point2d", "point3d", "angle", "unknown").
         */
        function normalizeType(prop) {
            if (!prop) {
                return "unknown";
            }

            var valType = prop.propertyValueType;
            var matchName = prop.matchName ? prop.matchName : "";

            // TEXT_DOCUMENT -> text
            if (valType === PropertyValueType.TEXT_DOCUMENT) {
                return "text";
            }

            // COLOR -> color
            if (valType === PropertyValueType.COLOR) {
                return "color";
            }

            // TwoD / TwoD_SPATIAL -> point2d
            if (valType === PropertyValueType.TwoD || valType === PropertyValueType.TwoD_SPATIAL) {
                return "point2d";
            }

            // ThreeD / ThreeD_SPATIAL -> point3d
            if (valType === PropertyValueType.ThreeD || valType === PropertyValueType.ThreeD_SPATIAL) {
                return "point3d";
            }

            // OneD -> boolean, angle, or number
            if (valType === PropertyValueType.OneD) {
                // Checkbox Control
                if (matchName.indexOf("Checkbox") !== -1 || matchName === "ADBE Checkbox Control-0001") {
                    return "boolean";
                }

                // Angle Control
                if (matchName.indexOf("Angle") !== -1 || matchName === "ADBE Angle Control-0001") {
                    return "angle";
                }

                // Inspect parent hierarchy for effects
                if (prop.parentProperty) {
                    var parentMatch = prop.parentProperty.matchName || "";
                    if (parentMatch.indexOf("Checkbox") !== -1) {
                        return "boolean";
                    }
                    if (parentMatch.indexOf("Angle") !== -1) {
                        return "angle";
                    }
                }

                // Default float slider / numerical values
                return "number";
            }

            return "unknown";
        }

        /**
         * Converts complex After Effects values into JSON-friendly types.
         *
         * @param {*} val - Raw property value from AE.
         * @param {string} type - Normalized data type.
         * @returns {*} Serialized primitive value or array.
         */
        function serializeValue(val, type) {
            if (val === null || typeof val === "undefined") {
                return null;
            }

            switch (type) {
                case "text":
                    if (val && typeof val === "object") {
                        if (typeof val.text === "string") {
                            return val.text;
                        }
                        return val.toString();
                    }
                    return String(val);

                case "color":
                    if (val instanceof Array || (val && typeof val.length === "number")) {
                        var r = val[0] !== undefined ? Number(val[0]) : 0;
                        var g = val[1] !== undefined ? Number(val[1]) : 0;
                        var b = val[2] !== undefined ? Number(val[2]) : 0;
                        var a = val[3] !== undefined ? Number(val[3]) : 1;
                        return [r, g, b, a];
                    }
                    return [0, 0, 0, 1];

                case "point2d":
                    if (val instanceof Array || (val && typeof val.length === "number")) {
                        return [Number(val[0] || 0), Number(val[1] || 0)];
                    }
                    return [0, 0];

                case "point3d":
                    if (val instanceof Array || (val && typeof val.length === "number")) {
                        return [Number(val[0] || 0), Number(val[1] || 0), Number(val[2] || 0)];
                    }
                    return [0, 0, 0];

                case "boolean":
                    if (typeof val === "boolean") {
                        return val;
                    }
                    return val !== 0 && val !== "0";

                case "angle":
                case "number":
                    return Number(val);

                default:
                    if (typeof val === "object") {
                        try {
                            return val.toString();
                        } catch (e) {
                            return null;
                        }
                    }
                    return val;
            }
        }

        /**
         * Traverses properties upwards recursively to determine the containing parent Layer.
         *
         * @param {Property} sourceProp - The source After Effects Property object.
         * @returns {Layer|null} Parent layer object or null.
         */
        /**
         * Determines whether an Essential Graphics media-replacement slot is a
         * still image, a video, or an audio-only file, by inspecting the
         * layer's actual footage source (After Effects has no direct "media
         * type" flag on the override property itself - only the real
         * FootageItem it currently points at knows this).
         *
         * @param {Layer} layer - The layer whose .source this slot exposes.
         * @returns {string} "IMAGE" | "VIDEO" | "AUDIO" (defaults to "IMAGE" if undetectable).
         */
        function detectMediaType(layer) {
            if (!layer || !layer.source) {
                return "IMAGE";
            }

            var source = layer.source;
            if (!(source instanceof FootageItem)) {
                // A precomp or other non-footage source dragged into Essential
                // Graphics as a media slot - no real "replace with an uploaded
                // file" concept applies, treat as an image slot by default.
                return "IMAGE";
            }

            var mainSource = source.mainSource;
            if (mainSource && mainSource.isStill) {
                return "IMAGE";
            }

            if (source.hasAudio && !source.hasVideo) {
                return "AUDIO";
            }

            return "VIDEO";
        }

        /**
         * The pixel dimensions of the sample asset currently sitting in this
         * media slot (e.g. an author's placeholder logo/image), so the buyer
         * upload UI can hint "this should be ~1920x1080" instead of the
         * buyer discovering a mismatch only after rendering. Real footage
         * only - a precomp or other non-FootageItem source (see
         * detectMediaType() above) has no fixed native size to report, so
         * this returns null in that case rather than guessing.
         *
         * @param {Layer} layer - The layer whose .source this slot exposes.
         * @returns {{width: number, height: number}|null}
         */
        function getSourceDimensions(layer) {
            if (!layer || !layer.source) {
                return null;
            }

            var source = layer.source;
            if (!(source instanceof FootageItem)) {
                return null;
            }

            if (typeof source.width !== "number" || typeof source.height !== "number"
                || source.width <= 0 || source.height <= 0) {
                return null;
            }

            return { width: source.width, height: source.height };
        }

        /**
         * Mirrors the subset of ManifestValidator.php's per-variable checks
         * that this scanner can realistically get wrong on its own (key/
         * label/metadata.compositionName/metadata.layerName non-empty
         * strings) - not a full reimplementation of the PHP validator, just
         * an early, local warning so a broken variable is visible right
         * here instead of only surfacing later as a generic
         * MANIFEST_VARIABLE_INVALID after an upload round-trip.
         *
         * @param {Array} vars - The scanned variables array.
         * @returns {Array<string>} Human-readable warning strings, empty if all clean.
         */
        function validateVariablesLocally(vars) {
            var warnings = [];
            for (var i = 0; i < vars.length; i++) {
                var v = vars[i];
                var label = v.key || v.label || ("variables[" + i + "]");
                if (!v.key || typeof v.key !== "string") {
                    warnings.push(label + ": \"key\" boş.");
                }
                if (!v.label || typeof v.label !== "string") {
                    warnings.push(label + ": \"label\" boş.");
                }
                var metadata = v.metadata || {};
                if (!metadata.compositionName) {
                    warnings.push(label + ": metadata.compositionName boş (tip=" + v.type + ").");
                }
                if (!metadata.layerName) {
                    warnings.push(label + ": metadata.layerName boş (tip=" + v.type + ") - AE'nin bu özel katman/kontrol türü için layer nesnesi doğru tespit edilemedi.");
                }
            }
            return warnings;
        }

        function getSourceLayer(sourceProp) {
            if (!sourceProp) {
                return null;
            }
            // A whole-layer media-replacement slot (matchName "ADBE AV
            // Layer" - the layer's own Source published directly to
            // Essential Graphics, not a nested effect control) surfaces
            // essentialPropertySource as the layer's own root object,
            // which has no parentProperty of its own (every real nested
            // Property/PropertyGroup always does - the climb below always
            // bottoms out AT the layer, never past it). ExtendScript's
            // host objects return null (not undefined) for "no such
            // related object" - a first attempt at this fix checked
            // `typeof === "undefined"`, which null fails (typeof null is
            // "object"), so it never actually caught this case; a real
            // manifest re-generated after that fix still shipped
            // layerName: null (confirmed via a live re-test). Checking
            // for falsy instead of the exact undefined type handles both.
            if (!sourceProp.parentProperty) {
                return sourceProp;
            }
            var parent = sourceProp.parentProperty;
            while (parent && parent.parentProperty) {
                parent = parent.parentProperty;
            }
            return parent;
        }

        /**
         * Builds a unique identity string for a property by joining the display names of
         * every group from the layer down to the property itself (e.g. "Effects/Text Size/Slider").
         * Needed because leaf property names/matchNames are often generic (every Slider Control's
         * value is named "Slider"), so only the full path can distinguish sibling effect instances.
         *
         * @param {Property} sourceProp - The source After Effects Property object.
         * @returns {string} Slash-joined path from the layer to the property.
         */
        function getPropertyPath(sourceProp) {
            var parts = [];
            var current = sourceProp;
            while (current && current.parentProperty) {
                parts.unshift(current.name);
                current = current.parentProperty;
            }
            return parts.join("/");
        }

        /**
         * Recursive JSON stringifier supporting ExtendScript.
         * Ensures compatibility (and pretty-printed 4-space indentation) in older
         * environments where window.JSON might be missing.
         *
         * @param {*} obj - Target data structure.
         * @returns {string} Stringified, indented JSON format.
         */
        function objectToJsonString(obj) {
            if (typeof JSON !== "undefined" && typeof JSON.stringify === "function") {
                try {
                    return JSON.stringify(obj, null, 4);
                } catch (e) { }
            }
            return stringifyValue(obj, 0);
        }

        function stringifyValue(obj, indentLevel) {
            var type = typeof obj;
            if (obj === null || type === "undefined") {
                return "null";
            }
            if (type === "number" || type === "boolean") {
                return String(obj);
            }
            if (type === "string") {
                return quoteJsonString(obj);
            }
            if (type === "object") {
                var childIndent = indentLevel + 1;
                var pad = indentSpaces(childIndent);
                var closePad = indentSpaces(indentLevel);

                if (obj instanceof Array || (typeof obj.length === "number" && typeof obj.splice === "function")) {
                    if (obj.length === 0) {
                        return "[]";
                    }
                    var items = [];
                    for (var i = 0; i < obj.length; i++) {
                        items.push(pad + stringifyValue(obj[i], childIndent));
                    }
                    return "[\n" + items.join(",\n") + "\n" + closePad + "]";
                }

                var keys = [];
                for (var key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        keys.push(key);
                    }
                }
                if (keys.length === 0) {
                    return "{}";
                }
                var pairs = [];
                for (var k = 0; k < keys.length; k++) {
                    pairs.push(pad + quoteJsonString(keys[k]) + ": " + stringifyValue(obj[keys[k]], childIndent));
                }
                return "{\n" + pairs.join(",\n") + "\n" + closePad + "}";
            }
            return "null";
        }

        function quoteJsonString(str) {
            return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
        }

        function indentSpaces(level) {
            var result = "";
            for (var i = 0; i < level; i++) {
                result += "    ";
            }
            return result;
        }

        /**
         * Simple write utility for saving text files in ExtendScript. Reports
         * the real failure reason instead of swallowing it - a silent
         * `catch (e) {}` here made every write failure (e.g. macOS denying
         * Desktop access to After Effects) look identical and undiagnosable.
         *
         * @param {string} filePath - Target path to save.
         * @param {string} content - Document contents.
         * @returns {{success: boolean, reason: (string|null)}}
         */
        function writeTextFile(filePath, content) {
            var file;
            try {
                file = new File(filePath);
                file.encoding = "UTF-8";
            } catch (e) {
                return { success: false, reason: "File nesnesi oluşturulamadı: " + e.toString() };
            }

            var opened;
            try {
                opened = file.open("w");
            } catch (e) {
                return { success: false, reason: "file.open('w') istisna fırlattı: " + e.toString() };
            }
            if (!opened) {
                var openErr = file.error ? file.error : "bilinmiyor";
                return { success: false, reason: "file.open('w') false döndü (file.error: " + openErr + ")" };
            }

            try {
                file.write(content);
            } catch (e) {
                file.close();
                return { success: false, reason: "file.write() istisna fırlattı: " + e.toString() };
            }

            var closeErr = null;
            try {
                if (!file.close()) {
                    closeErr = file.error ? file.error : "bilinmiyor";
                }
            } catch (e) {
                closeErr = e.toString();
            }
            if (closeErr) {
                return { success: false, reason: "file.close() başarısız: " + closeErr };
            }

            return { success: true, reason: null };
        }

        /**
         * Uploads {registrationToken, manifest} to Laravel's
         * POST /api/manifest-upload (Cloud Render Platform Technical
         * Specification v1.0, §5.6) via the system's real `curl` binary,
         * run through system.callSystem() - ExtendScript has no native
         * HTTPS client (its Socket object's TLS support is unreliable), so
         * shelling out to curl is the standard, documented way Adobe
         * scripts make real HTTPS calls. The request body is written to a
         * temp file first (--data-binary @file) instead of inlining the
         * JSON into the shell command string, so nothing about the
         * manifest's own content needs shell-escaping - only the temp file
         * path does.
         *
         * @param {string} registrationToken
         * @param {string} manifestJsonString - Already-serialized manifest (objectToJsonString(manifest)).
         * @returns {{success: boolean, message: string, syncedVariableCount: (number|null)}}
         */
        function uploadManifestToLaravel(registrationToken, manifestJsonString) {
            var tempFilePath = Folder.temp.fsName +
                (($.os.indexOf("Windows") !== -1) ? "\\" : "/") +
                "pratiktools_manifest_upload_" + new Date().getTime() + ".json";

            var requestBody = '{"registrationToken":' + quoteJsonString(registrationToken) +
                ',"manifest":' + manifestJsonString + '}';

            var writeResult = writeTextFile(tempFilePath, requestBody);
            if (!writeResult.success) {
                return {
                    success: false,
                    message: "İstek gövdesi geçici dosyaya yazılamadı: " + writeResult.reason,
                    syncedVariableCount: null
                };
            }

            var statusMarker = "HTTP_STATUS:";
            var cmd = 'curl -sS -X POST "' + MANIFEST_UPLOAD_URL + '"' +
                ' -H "Content-Type: application/json"' +
                ' --data-binary @"' + tempFilePath + '"' +
                ' -w "\\n' + statusMarker + '%{http_code}"' +
                ' 2>&1';

            var rawOutput;
            try {
                rawOutput = system.callSystem(cmd);
            } catch (e) {
                cleanupTempFile(tempFilePath);
                return {
                    success: false,
                    message: "system.callSystem() curl'ü çalıştıramadı: " + e.toString() +
                        " (curl bu makinede kurulu olmayabilir).",
                    syncedVariableCount: null
                };
            }

            cleanupTempFile(tempFilePath);

            rawOutput = rawOutput ? String(rawOutput) : "";
            var markerIndex = rawOutput.lastIndexOf(statusMarker);
            var body = trimString(markerIndex !== -1 ? rawOutput.substring(0, markerIndex) : rawOutput);
            var statusCode = markerIndex !== -1
                ? trimString(rawOutput.substring(markerIndex + statusMarker.length))
                : "";

            if (body.charAt(0) !== "{") {
                // curl kendisi başarısız oldu (DNS/network/curl bulunamadı) -
                // gövde gerçek bir JSON API yanıtı değil.
                return {
                    success: false,
                    message: "Ağ isteği başarısız oldu (HTTP " + (statusCode || "?") + "): " +
                        (body || "boş yanıt"),
                    syncedVariableCount: null
                };
            }

            var isSuccess = body.indexOf('"success":true') !== -1;
            var messageMatch = body.match(/"message"\s*:\s*"([^"]*)"/);
            var errorMatch = body.match(/"error"\s*:\s*"([^"]*)"/);
            var syncedMatch = body.match(/"syncedVariableCount"\s*:\s*(\d+)/);

            var message = messageMatch ? messageMatch[1] : body;
            if (!isSuccess && errorMatch) {
                message = "[" + errorMatch[1] + "] " + message;
            }

            return {
                success: isSuccess,
                message: message,
                syncedVariableCount: syncedMatch ? parseInt(syncedMatch[1], 10) : null
            };
        }

        /**
         * Best-effort temp file cleanup - never lets a cleanup failure mask
         * the real upload result.
         *
         * @param {string} filePath
         */
        function cleanupTempFile(filePath) {
            try {
                var f = new File(filePath);
                if (f.exists) {
                    f.remove();
                }
            } catch (e) {
                log("UYARI: Geçici dosya silinemedi: " + filePath + " (" + e.toString() + ")");
            }
        }

        /**
         * ISO 8601 UTC timestamp, hand-built rather than relying on
         * Date.prototype.toISOString() - this ExtendScript engine's real
         * feature set is not guaranteed (this same file already
         * feature-detects the JSON global for exactly this reason, see
         * objectToJsonString()), so this avoids assuming an unverified API.
         *
         * @returns {string} e.g. "2026-07-30T12:34:56.789Z".
         */
        function nowIso() {
            var d = new Date();

            function pad(num, len) {
                var s = String(num);
                while (s.length < len) {
                    s = "0" + s;
                }
                return s;
            }

            return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1, 2) + "-" + pad(d.getUTCDate(), 2) +
                "T" + pad(d.getUTCHours(), 2) + ":" + pad(d.getUTCMinutes(), 2) + ":" + pad(d.getUTCSeconds(), 2) +
                "." + pad(d.getUTCMilliseconds(), 3) + "Z";
        }

        /**
         * Outputs debug strings to the ExtendScript Console.
         *
         * @param {string} message - Text log.
         */
        function log(message) {
            try {
                $.writeln(message);
            } catch (e) { }
        }

    })();
