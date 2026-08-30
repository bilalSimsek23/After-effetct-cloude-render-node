// apply-variables.jsx — the real Variable Engine (Faz 8A).
//
// Beklenen payload: { variablesFile: string, reportFile: string, dryRun?: boolean }
//
// variablesFile is a resolved-variables.json written by Node's
// VariableResolver (already combines variables.json + manifest.json into
// one real, type-normalized list) — this script never reads the original
// variables.json or manifest.json itself, and Node never decides which AE
// property a variable maps to; that lookup happens entirely here, once,
// cached (PropertyResolver below), never re-traversing the project per
// variable.
//
// Every type is applied through a handler looked up in a table
// (VariableHandlers) — no switch-case — so adding a new type later means
// registering one more handler, never touching this file's control flow
// (Open/Closed).

#include "json-serializer.jsx"
#include "asset-importer.jsx"

(function () {
  var startTime = new Date().getTime();

  var report = {
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    warnings: [],
    errors: [],
    durationMs: 0,
  };

  /**
   * PropertyResolver — resolves a real, settable Property object from a
   * compositionName + layerName + propertyPath (e.g.
   * compositionName="MainComp", layerName="TitleTextLayer",
   * propertyPath=["Source Text"] or ["Effects","Tracking Amount","Slider"]).
   *
   * Faz 8C — this mirrors the real, production `apply_manifest.jsx`
   * reference exactly (see docs/scanner-manifest-metadata-contract.md):
   * composition is resolved first (required, since two different
   * compositions can share a layer name — an ambiguity the reference
   * implementation also guards against), then the layer within that one
   * composition, then the property. Resolution order matches the
   * reference's own fallback chain: `propertyPath` walk first
   * (`findPropertyByPath`); if that fails, a recursive matchName+
   * displayName search over the entire layer property tree
   * (`searchPropertyGroup`), preferring the entry whose own `.name`
   * equals the propertyPath's last segment, else the first matchName-only
   * hit. Essential Graphics itself is never touched here — by the time a
   * manifest reaches this script, the Scanner has already resolved real
   * layer/property addresses from it; this script only re-locates them
   * (comp.motionGraphicsTemplateController(index) does not exist in this
   * AE build's real API surface, confirmed via reflect in Faz 8A — layer/
   * property-tree traversal is the only real, always-available mechanism).
   *
   * Composition and layer lookups are both cached (including negative
   * results), layer cache scoped per composition (keyed by comp.id), so a
   * project with several variables across several comps never re-scans
   * the whole project per variable.
   */
  var PropertyResolver = (function () {
    var compCache = {};
    var layerCacheByComp = {};

    function findCompositionByName(name) {
      if (Object.prototype.hasOwnProperty.call(compCache, name)) {
        return compCache[name];
      }
      var found = null;
      for (var i = 1; i <= app.project.numItems && !found; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === name) {
          found = item;
        }
      }
      compCache[name] = found;
      return found;
    }

    function findLayerByName(comp, name) {
      var cacheKey = comp.id;
      if (!layerCacheByComp[cacheKey]) {
        layerCacheByComp[cacheKey] = {};
      }
      var cache = layerCacheByComp[cacheKey];
      if (Object.prototype.hasOwnProperty.call(cache, name)) {
        return cache[name];
      }
      var found = null;
      for (var l = 1; l <= comp.numLayers && !found; l++) {
        if (comp.layer(l).name === name) {
          found = comp.layer(l);
        }
      }
      cache[name] = found;
      return found;
    }

    // Wrapped in try/catch: an AE property-name lookup can throw (not just
    // return null) when a segment doesn't exist on a given property type —
    // this must fail soft, not abort the whole resolution, so the
    // matchName+displayName fallback below still gets a chance to run.
    function walkPath(layer, propertyPath) {
      var current = layer;
      for (var p = 0; p < propertyPath.length; p++) {
        if (!current) {
          return null;
        }
        try {
          current = current.property(propertyPath[p]);
        } catch (e) {
          return null;
        }
      }
      return current;
    }

    // Mirrors apply_manifest.jsx's searchPropertyGroup exactly: recursive
    // traversal of the entire layer property tree (folders are plain
    // PropertyGroups — INDEXED_GROUP or NAMED_GROUP — only PROPERTY leaves
    // carry a matchName worth comparing), preferring the first property
    // whose matchName AND displayName (.name) both match, else remembering
    // the first matchName-only hit and using it if no exact match is ever
    // found anywhere in the tree.
    function searchPropertyGroup(propertyGroup, matchName, propName, state) {
      for (var i = 1; i <= propertyGroup.numProperties && !state.exact; i++) {
        var prop = propertyGroup.property(i);
        if (prop.matchName === matchName) {
          if (prop.name === propName) {
            state.exact = prop;
          } else if (!state.fallback) {
            state.fallback = prop;
          }
        }
        if (
          !state.exact &&
          (prop.propertyType === PropertyType.INDEXED_GROUP ||
            prop.propertyType === PropertyType.NAMED_GROUP)
        ) {
          searchPropertyGroup(prop, matchName, propName, state);
        }
      }
    }

    function findByMatchName(layer, matchName, propName) {
      if (!matchName) {
        return null;
      }
      var state = { exact: null, fallback: null };
      searchPropertyGroup(layer, matchName, propName, state);
      return state.exact || state.fallback;
    }

    return {
      find: function (compositionName, layerName, propertyPath, propertyMatchName) {
        var comp = findCompositionByName(compositionName);
        if (!comp) {
          return null;
        }
        var layer = findLayerByName(comp, layerName);
        if (!layer) {
          return null;
        }
        var viaPath = walkPath(layer, propertyPath);
        if (viaPath) {
          return viaPath;
        }
        var lastSegment = propertyPath.length > 0 ? propertyPath[propertyPath.length - 1] : null;
        return findByMatchName(layer, propertyMatchName, lastSegment);
      },
    };
  })();

  /**
   * Real font check via app.fonts.getFontsByPostScriptName() — real
   * testing (Faz 8A) found the originally assumed technique (assign the
   * font to a throwaway `new TextDocument()` and compare) throws "Unable
   * to set value as it is not associated with a layer" in this AE build:
   * a standalone, layer-less TextDocument rejects property assignment
   * outright. app.fonts is a real, read-only, non-invasive API instead:
   * for a genuinely installed PostScript name it returns a Font whose
   * `isSubstitute` is false; for a missing one, AE still returns a
   * placeholder entry (echoing the requested name back) but flags
   * `isSubstitute: true` — confirmed by comparing a real (Helvetica) vs.
   * a deliberately nonexistent PostScript name side by side.
   */
  function isFontAvailable(postScriptName) {
    var matches = app.fonts.getFontsByPostScriptName(postScriptName);
    if (!matches || matches.length === 0) {
      return false;
    }
    return matches[0].isSubstitute === false;
  }

  function hexToRgba(hex) {
    var clean = hex.charAt(0) === '#' ? hex.substring(1) : hex;
    if (clean.length === 6) {
      clean += 'FF';
    }
    if (clean.length !== 8) {
      throw new Error('INVALID_VALUE: COLOR hex format invalid: ' + hex);
    }
    return [
      parseInt(clean.substring(0, 2), 16) / 255,
      parseInt(clean.substring(2, 4), 16) / 255,
      parseInt(clean.substring(4, 6), 16) / 255,
      parseInt(clean.substring(6, 8), 16) / 255,
    ];
  }

  function applyMediaReplacement(value, compositionName, layerName) {
    var assetPath = typeof value === 'string' ? value : value.assetPath;
    AssetImporter.replaceLayerSource(compositionName, layerName, assetPath);
  }

  // ---- Handlers: one function per type, looked up by a table — no switch-case, Open/Closed. ----
  var VariableHandlers = {};

  VariableHandlers.TEXT = function (prop, value) {
    if (typeof value !== 'string') {
      throw new Error('INVALID_VALUE: TEXT must be a string');
    }
    var textDocument = prop.value;
    if (textDocument.font && !isFontAvailable(textDocument.font)) {
      throw new Error('FONT_NOT_AVAILABLE:' + textDocument.font);
    }
    textDocument.text = value;
    prop.setValue(textDocument);
  };

  VariableHandlers.NUMBER = function (prop, value) {
    var num = Number(value);
    if (isNaN(num)) {
      throw new Error('INVALID_VALUE: NUMBER could not be converted to a number: ' + value);
    }
    prop.setValue(num);
  };

  VariableHandlers.ANGLE = VariableHandlers.NUMBER;
  VariableHandlers.DROPDOWN = VariableHandlers.NUMBER;

  VariableHandlers.BOOLEAN = function (prop, value) {
    prop.setValue(value ? 1 : 0);
  };

  VariableHandlers.COLOR = function (prop, value) {
    var rgba;
    if (typeof value === 'string') {
      rgba = hexToRgba(value);
    } else if (value && value.length) {
      rgba = value;
    } else {
      throw new Error('INVALID_VALUE: COLOR in unsupported format');
    }
    prop.setValue(rgba);
  };

  VariableHandlers.POINT2D = function (prop, value) {
    if (!value || value.length !== 2) {
      throw new Error('INVALID_VALUE: POINT2D must be [x,y]');
    }
    prop.setValue(value);
  };

  VariableHandlers.POINT3D = function (prop, value) {
    if (!value || value.length !== 3) {
      throw new Error('INVALID_VALUE: POINT3D must be [x,y,z]');
    }
    prop.setValue(value);
  };

  // IMAGE/VIDEO/AUDIO bind to a real LAYER by name (the manifest key),
  // not an Essential Graphics property — Essential Graphics' own media-
  // placeholder scripting surface is unreliable/undocumented enough
  // (consistent with Faz 5/7's finding that Media Encoder's own DoScript
  // support is similarly limited) that a direct, real ReplaceSource on a
  // named layer is the robust, working choice — verified against real
  // After Effects, not a heuristic guess.
  VariableHandlers.IMAGE = function (prop, value, compositionName, layerName) {
    applyMediaReplacement(value, compositionName, layerName);
  };
  VariableHandlers.VIDEO = VariableHandlers.IMAGE;
  VariableHandlers.AUDIO = VariableHandlers.IMAGE;

  var isMediaType = function (type) {
    return type === 'IMAGE' || type === 'VIDEO' || type === 'AUDIO';
  };

  // IMAGE/VIDEO/AUDIO are always optional (Faz 8C) — a buyer who didn't
  // upload a replacement leaves this entry with no real value, and the
  // original embedded asset must stay untouched, not crash on
  // `value.assetPath` of an undefined value.
  var hasMediaValue = function (value) {
    if (value === undefined || value === null || value === '') {
      return false;
    }
    if (typeof value === 'object' && !value.assetPath) {
      return false;
    }
    return true;
  };

  // ---- Main ----
  var variables = readJsonFile(payload.variablesFile);
  var dryRun = !!payload.dryRun;

  for (var v = 0; v < variables.length; v++) {
    var entry = variables[v];

    try {
      var handler = VariableHandlers[entry.type];
      if (!handler) {
        report.failedCount++;
        report.errors.push(entry.key + ': UNSUPPORTED_TYPE:' + entry.type);
        continue;
      }

      var prop = null;
      if (isMediaType(entry.type)) {
        if (!hasMediaValue(entry.value)) {
          // Buyer left this media slot unset — no-op, original embedded
          // asset stays exactly as it was in the project.
          report.skippedCount++;
          continue;
        }
        if (!AssetImporter.findLayerByName(entry.compositionName, entry.layerName)) {
          report.failedCount++;
          report.errors.push(
            entry.key + ': LAYER_NOT_FOUND:' + entry.compositionName + '/' + entry.layerName,
          );
          continue;
        }
      } else {
        prop = PropertyResolver.find(
          entry.compositionName,
          entry.layerName,
          entry.propertyPath,
          entry.propertyMatchName,
        );
        if (!prop) {
          report.failedCount++;
          report.errors.push(
            entry.key +
              ': PROPERTY_NOT_FOUND:' +
              entry.compositionName +
              '/' +
              entry.layerName +
              '/' +
              entry.propertyPath.join('/'),
          );
          continue;
        }
      }

      if (dryRun) {
        report.skippedCount++;
        continue;
      }

      handler(prop, entry.value, entry.compositionName, entry.layerName);
      report.updatedCount++;
    } catch (e) {
      report.failedCount++;
      report.errors.push(entry.key + ': ' + e.toString());
    }
  }

  report.durationMs = new Date().getTime() - startTime;

  writeJsonFile(payload.reportFile, report);
})();
