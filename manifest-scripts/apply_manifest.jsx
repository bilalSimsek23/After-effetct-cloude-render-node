#target aftereffects

/**
 * ExtendScript: Manifest Apply Engine (POC)
 *
 * Description: Reads manifest.json from the Desktop and applies each variable's
 *              defaultValue to the matching Essential Graphics property in the
 *              open After Effects project, resolved strictly via the
 *              composition -> layer -> property metadata chain stored in the manifest.
 *
 * Reads the pratiktools-render-node ManifestContract shape (key/label/type/
 * defaultValue/sortOrder/metadata.{compositionName,layerName,propertyPath[],
 * propertyMatchName} per variable — see generate_manifest.jsx and
 * docs/scanner-manifest-metadata-contract.md in that repo). propertyPath is
 * an array here, not a slash-joined string.
 *
 * Out of scope for this POC: rendering, Render Queue, Media Encoder, Output Modules,
 * proxies, uploads, or any cloud/queue integration.
 */

(function () {

    main();

    /**
     * Main orchestrator. Reads the manifest, applies every variable, logs
     * per-variable results, and prints a final summary.
     */
    function main() {
        log("----------------------------------------");
        log("Manifest Apply Engine started");

        var project = app.project;
        if (!project) {
            alert("Hata: Açık bir After Effects projesi bulunamadı.");
            log("Hata: Proje bulunamadı.");
            return;
        }

        var manifest = readManifest();
        if (!manifest) {
            return;
        }

        if (!manifest.variables || !(manifest.variables instanceof Array)) {
            alert("Hata: manifest.json içinde geçerli bir 'variables' listesi bulunamadı.");
            log("Hata: manifest.variables eksik veya geçersiz.");
            return;
        }

        var found = manifest.variables.length;
        var updated = 0;
        var failed = 0;

        app.beginUndoGroup("Apply Manifest");
        try {
            for (var i = 0; i < manifest.variables.length; i++) {
                var variable = manifest.variables[i];
                var result = applyVariable(variable);
                if (result) {
                    updated++;
                } else {
                    failed++;
                }
            }
        } finally {
            app.endUndoGroup();
        }

        log("--------------------------------");
        log("Variables Found");
        log(String(found));
        log("Updated");
        log(String(updated));
        log("Failed");
        log(String(failed));
        log("--------------------------------");
        log("----------------------------------------");

        alert("Manifest uygulandı.\nBulunan: " + found + "\nGüncellenen: " + updated + "\nBaşarısız: " + failed);
    }

    /**
     * Applies a single manifest variable to the project. Resolves comp -> layer -> property
     * strictly through the manifest's "metadata" block, then dispatches to the matching updater.
     * Never throws - all failures are logged and reported back as false.
     *
     * @param {Object} variable - A single entry from manifest.variables.
     * @returns {boolean} True if the property was found and updated successfully.
     */
    function applyVariable(variable) {
        var metadata = variable && variable.metadata;
        if (!metadata) {
            logFailure(variable, null, null, "Manifest girdisinde 'metadata' bloğu eksik.");
            return false;
        }

        var compName = metadata.compositionName;
        var layerName = metadata.layerName;
        var propertyPath = metadata.propertyPath; // array, e.g. ["Slider Control", "Slider"]
        var matchName = metadata.propertyMatchName;
        // Ayrı bir "displayName" alanı yok - son propertyPath segmenti her zaman
        // property'nin gerçek görünen adına eşit (generate_manifest.jsx bunu
        // garanti ediyor, bkz. o dosyadaki key/label üretimi).
        var propName = propertyPath && propertyPath.length ? propertyPath[propertyPath.length - 1] : null;
        var normalizedType = (variable.type || "").toLowerCase();

        var comp = findComposition(compName);
        if (!comp) {
            logFailure(variable, compName, layerName, "Composition bulunamadı: " + compName);
            return false;
        }

        var layer = findLayer(comp, layerName);
        if (!layer) {
            logFailure(variable, compName, layerName, "Layer bulunamadı: " + layerName);
            return false;
        }

        var property = null;
        if (propertyPath && propertyPath.length) {
            property = findPropertyByPath(layer, propertyPath);
        }
        if (!property) {
            property = findProperty(layer, propName, matchName);
        }
        if (!property) {
            logFailure(variable, compName, layerName, "Property bulunamadı: " + propName + " (" + matchName + ")");
            return false;
        }

        var oldValueDisplay = describeValue(property, normalizedType);

        try {
            var applied = applyValue(property, normalizedType, variable.defaultValue);
            if (!applied) {
                logFailure(variable, compName, layerName, "Desteklenmeyen type: " + variable.type);
                return false;
            }
        } catch (e) {
            logFailure(variable, compName, layerName, "Değer uygulanamadı: " + e.toString());
            return false;
        }

        var newValueDisplay = describeValue(property, normalizedType);
        logSuccess(compName, layerName, propName, oldValueDisplay, newValueDisplay);
        return true;
    }

    /**
     * Reads and parses manifest.json from the Desktop.
     *
     * @returns {Object|null} Parsed manifest object, or null on failure (already logged/alerted).
     */
    function readManifest() {
        var desktopPath = Folder.desktop.fsName;
        var separator = ($.os.indexOf("Windows") !== -1) ? "\\" : "/";
        var manifestPath = desktopPath + separator + "manifest_modified.json";

        var file = new File(manifestPath);
        if (!file.exists) {
            alert("Hata: manifest_modified.json bulunamadı.\nBeklenen yol: " + manifestPath);
            log("Hata: manifest_modified.json bulunamadı: " + manifestPath);
            return null;
        }

        var rawText;
        try {
            file.encoding = "UTF-8";
            if (!file.open("r")) {
                throw new Error("Dosya açılamadı.");
            }
            rawText = file.read();
            file.close();
        } catch (e) {
            alert("Hata: manifest_modified.json okunamadı.\n" + e.toString());
            log("Hata: manifest_modified.json okunamadı: " + e.toString());
            return null;
        }

        try {
            if (typeof JSON !== "undefined" && typeof JSON.parse === "function") {
                return JSON.parse(rawText);
            }
            return parseJsonString(rawText);
        } catch (e) {
            alert("Hata: manifest_modified.json geçersiz JSON içeriyor.\n" + e.toString());
            log("Hata: JSON parse hatası: " + e.toString());
            return null;
        }
    }

    /**
     * Minimal hand-written JSON parser for ExtendScript engines that lack a global JSON object.
     * Supports objects, arrays, strings (with standard escapes), numbers, true/false/null.
     *
     * @param {string} text - Raw JSON text.
     * @returns {*} Parsed value.
     */
    function parseJsonString(text) {
        var i = 0;
        var len = text.length;

        function fail(msg) {
            throw new Error(msg + " (konum: " + i + ")");
        }

        function skipWhitespace() {
            while (i < len) {
                var c = text.charAt(i);
                if (c === " " || c === "\t" || c === "\n" || c === "\r") {
                    i++;
                } else {
                    break;
                }
            }
        }

        function parseValue() {
            skipWhitespace();
            var c = text.charAt(i);
            if (c === "{") return parseObject();
            if (c === "[") return parseArray();
            if (c === "\"") return parseString();
            if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
            if (text.substring(i, i + 4) === "true") { i += 4; return true; }
            if (text.substring(i, i + 5) === "false") { i += 5; return false; }
            if (text.substring(i, i + 4) === "null") { i += 4; return null; }
            fail("Beklenmeyen karakter '" + c + "'");
        }

        function parseObject() {
            var obj = {};
            i++; // {
            skipWhitespace();
            if (text.charAt(i) === "}") { i++; return obj; }
            while (true) {
                skipWhitespace();
                if (text.charAt(i) !== "\"") fail("String key bekleniyordu");
                var key = parseString();
                skipWhitespace();
                if (text.charAt(i) !== ":") fail("':' bekleniyordu");
                i++;
                obj[key] = parseValue();
                skipWhitespace();
                var ch = text.charAt(i);
                if (ch === ",") { i++; continue; }
                if (ch === "}") { i++; break; }
                fail("',' veya '}' bekleniyordu");
            }
            return obj;
        }

        function parseArray() {
            var arr = [];
            i++; // [
            skipWhitespace();
            if (text.charAt(i) === "]") { i++; return arr; }
            while (true) {
                arr.push(parseValue());
                skipWhitespace();
                var ch = text.charAt(i);
                if (ch === ",") { i++; continue; }
                if (ch === "]") { i++; break; }
                fail("',' veya ']' bekleniyordu");
            }
            return arr;
        }

        function parseString() {
            var result = "";
            i++; // opening quote
            while (i < len) {
                var c = text.charAt(i);
                if (c === "\"") {
                    i++;
                    return result;
                }
                if (c === "\\") {
                    i++;
                    var esc = text.charAt(i);
                    switch (esc) {
                        case "\"": result += "\""; break;
                        case "\\": result += "\\"; break;
                        case "/": result += "/"; break;
                        case "b": result += "\b"; break;
                        case "f": result += "\f"; break;
                        case "n": result += "\n"; break;
                        case "r": result += "\r"; break;
                        case "t": result += "\t"; break;
                        case "u":
                            var hex = text.substring(i + 1, i + 5);
                            result += String.fromCharCode(parseInt(hex, 16));
                            i += 4;
                            break;
                        default:
                            fail("Geçersiz escape karakteri: " + esc);
                    }
                    i++;
                } else {
                    result += c;
                    i++;
                }
            }
            fail("String sonlandırılmamış");
        }

        function parseNumber() {
            var start = i;
            if (text.charAt(i) === "-") i++;
            while (i < len && text.charAt(i) >= "0" && text.charAt(i) <= "9") i++;
            if (text.charAt(i) === ".") {
                i++;
                while (i < len && text.charAt(i) >= "0" && text.charAt(i) <= "9") i++;
            }
            if (text.charAt(i) === "e" || text.charAt(i) === "E") {
                i++;
                if (text.charAt(i) === "+" || text.charAt(i) === "-") i++;
                while (i < len && text.charAt(i) >= "0" && text.charAt(i) <= "9") i++;
            }
            return Number(text.substring(start, i));
        }

        var value = parseValue();
        skipWhitespace();
        return value;
    }

    /**
     * Finds a top-level composition by name.
     *
     * @param {string} name - Composition name from manifest.metadata.compositionName.
     * @returns {CompItem|null}
     */
    function findComposition(name) {
        var project = app.project;
        for (var i = 1; i <= project.numItems; i++) {
            var item = project.item(i);
            if (item instanceof CompItem && item.name === name) {
                return item;
            }
        }
        return null;
    }

    /**
     * Finds a layer by name within a composition.
     *
     * @param {CompItem} comp - Composition to search.
     * @param {string} layerName - Layer name from manifest.metadata.layerName.
     * @returns {Layer|null}
     */
    function findLayer(comp, layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.name === layerName) {
                return layer;
            }
        }
        return null;
    }

    /**
     * Resolves a property by walking the exact effect/group path recorded by the generator
     * (manifest.metadata.propertyPath, e.g. ["Tracking Amount", "Slider"]). This is the only
     * reliable way to tell apart sibling same-type controls on one layer (e.g. six Slider
     * Controls all named "Slider" with matchName "ADBE Slider Control-0001") - property/
     * matchName alone cannot distinguish them.
     *
     * @param {Layer} layer - Layer to search.
     * @param {Array} segments - Path segments from manifest.metadata.propertyPath.
     * @returns {Property|null}
     */
    function findPropertyByPath(layer, segments) {
        var current = layer;
        for (var i = 0; i < segments.length; i++) {
            var next;
            try {
                next = current.property(segments[i]);
            } catch (e) {
                return null;
            }
            if (!next) {
                return null;
            }
            current = next;
        }
        return current;
    }

    /**
     * Recursively resolves a property under a layer using the manifest's matchName
     * (authoritative, locale-independent) with the display name as a disambiguator
     * when several properties share the same matchName (e.g. two Slider Controls).
     * Fallback for manifests without propertyPath - ambiguous when multiple sibling
     * controls share both name and matchName (returns the first one found).
     *
     * @param {Layer} layer - Layer to search.
     * @param {string} propName - Display name (last segment of manifest.metadata.propertyPath).
     * @param {string} matchName - matchName from manifest.metadata.propertyMatchName.
     * @returns {Property|null}
     */
    function findProperty(layer, propName, matchName) {
        return searchPropertyGroup(layer, propName, matchName);
    }

    function searchPropertyGroup(group, propName, matchName) {
        var fallback = null;

        for (var i = 1; i <= group.numProperties; i++) {
            var prop;
            try {
                prop = group.property(i);
            } catch (e) {
                continue;
            }
            if (!prop) {
                continue;
            }

            if (prop.matchName === matchName) {
                if (prop.name === propName) {
                    return prop;
                }
                if (!fallback) {
                    fallback = prop;
                }
            }

            if (prop.propertyType !== PropertyType.PROPERTY) {
                var found = searchPropertyGroup(prop, propName, matchName);
                if (found) {
                    if (found.name === propName) {
                        return found;
                    }
                    if (!fallback) {
                        fallback = found;
                    }
                }
            }
        }

        return fallback;
    }

    /**
     * Dispatches a manifest value to the correct updater based on normalizedType.
     *
     * @param {Property} property - Resolved AE property.
     * @param {string} normalizedType - One of the manifest's normalized types.
     * @param {*} value - Value to apply (manifest.defaultValue).
     * @returns {boolean} True if a supported updater handled the value.
     */
    function applyValue(property, normalizedType, value) {
        switch (normalizedType) {
            case "text":
                updateText(property, value);
                return true;
            case "number":
            case "angle":
                updateSlider(property, value);
                return true;
            case "color":
                updateColor(property, value);
                return true;
            case "boolean":
                updateCheckbox(property, value);
                return true;
            case "point2d":
            case "point3d":
                updatePoint(property, value);
                return true;
            default:
                return false;
        }
    }

    function updateText(property, value) {
        var textDocument = property.value;
        textDocument.text = String(value);
        property.setValue(textDocument);
    }

    function updateSlider(property, value) {
        property.setValue(Number(value));
    }

    function updateColor(property, value) {
        if (!(value instanceof Array)) {
            throw new Error("Color değeri dizi (array) değil.");
        }
        var r = value[0] !== undefined ? Number(value[0]) : 0;
        var g = value[1] !== undefined ? Number(value[1]) : 0;
        var b = value[2] !== undefined ? Number(value[2]) : 0;
        var a = value[3] !== undefined ? Number(value[3]) : 1;
        property.setValue([r, g, b, a]);
    }

    function updateCheckbox(property, value) {
        var boolValue = (value === true || value === 1 || value === "1" || value === "true");
        property.setValue(boolValue ? 1 : 0);
    }

    function updatePoint(property, value) {
        if (!(value instanceof Array)) {
            throw new Error("Point değeri dizi (array) değil.");
        }
        var point = [];
        for (var i = 0; i < value.length; i++) {
            point.push(Number(value[i]));
        }
        property.setValue(point);
    }

    /**
     * Produces a human-readable snapshot of a property's current value for console logging.
     *
     * @param {Property} property - AE property.
     * @param {string} normalizedType - Manifest normalized type.
     * @returns {string}
     */
    function describeValue(property, normalizedType) {
        try {
            var val = property.value;
            switch (normalizedType) {
                case "text":
                    return val && typeof val.text === "string" ? val.text : String(val);
                case "boolean":
                    return (val !== 0 && val !== "0") ? "true" : "false";
                case "color":
                case "point2d":
                case "point3d":
                    if (val instanceof Array || (val && typeof val.length === "number")) {
                        var parts = [];
                        for (var i = 0; i < val.length; i++) {
                            parts.push(String(val[i]));
                        }
                        return "[" + parts.join(", ") + "]";
                    }
                    return String(val);
                default:
                    return String(val);
            }
        } catch (e) {
            return "N/A";
        }
    }

    function logSuccess(compName, layerName, propName, oldValue, newValue) {
        log("--------------------------------");
        log("Updated");
        log("Composition:");
        log(compName);
        log("Layer:");
        log(layerName);
        log("Property:");
        log(propName);
        log("Old Value:");
        log(oldValue);
        log("New Value:");
        log(newValue);
        log("OK");
        log("--------------------------------");
    }

    function logFailure(variable, compName, layerName, reason) {
        var propertyPath = variable && variable.metadata ? variable.metadata.propertyPath : null;
        var propName = propertyPath && propertyPath.length ? propertyPath[propertyPath.length - 1] : null;
        log("--------------------------------");
        log("Failed");
        log("Composition:");
        log(compName || "N/A");
        log("Layer:");
        log(layerName || "N/A");
        log("Property:");
        log(propName || "N/A");
        log("Reason:");
        log(reason);
        log("--------------------------------");
    }

    function log(message) {
        try {
            $.writeln(message);
        } catch (e) { }
    }

})();
