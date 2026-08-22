// asset-importer.jsx — real footage import/reuse/replace helpers for
// IMAGE/VIDEO/AUDIO variables. #include'd by apply-variables.jsx only —
// never run standalone, never called directly by Node.
//
// Reuses an already-imported FootageItem (matched by real file path)
// instead of re-importing the same asset for every variable that
// references it, so repeated media replacements never leave unused,
// duplicate footage items behind in the project.

function AssetImporter() {}

AssetImporter.findExistingFootageItem = function (fsName) {
  for (var i = 1; i <= app.project.numItems; i++) {
    var item = app.project.item(i);
    if (item instanceof FootageItem && item.mainSource instanceof FileSource) {
      if (item.mainSource.file && item.mainSource.file.fsName === fsName) {
        return item;
      }
    }
  }
  return null;
};

AssetImporter.importOrReuse = function (assetPath) {
  var fileObj = new File(assetPath);
  if (!fileObj.exists) {
    throw new Error('ASSET_NOT_FOUND:' + assetPath);
  }

  var existing = AssetImporter.findExistingFootageItem(fileObj.fsName);
  if (existing) {
    return existing;
  }

  var importOptions = new ImportOptions(fileObj);
  return app.project.importFile(importOptions);
};

/**
 * Faz 8C — scoped by compositionName, mirroring PropertyResolver in
 * apply-variables.jsx: two different compositions can have layers with
 * the same name, so a composition-agnostic scan could silently replace
 * the wrong layer's source. compositionName is required on every
 * manifest variable (see ResolvedVariableEntry), including IMAGE/VIDEO/
 * AUDIO ones.
 */
AssetImporter.findLayerByName = function (compositionName, name) {
  var comp = null;
  for (var i = 1; i <= app.project.numItems && !comp; i++) {
    var item = app.project.item(i);
    if (item instanceof CompItem && item.name === compositionName) {
      comp = item;
    }
  }
  if (!comp) {
    return null;
  }
  for (var l = 1; l <= comp.numLayers; l++) {
    var layer = comp.layer(l);
    if (layer.name === name) {
      return layer;
    }
  }
  return null;
};

/** Real ReplaceSource — imports (or reuses) the asset first, replaces second, exactly as the spec requires. */
AssetImporter.replaceLayerSource = function (compositionName, layerName, assetPath) {
  var layer = AssetImporter.findLayerByName(compositionName, layerName);
  if (!layer) {
    throw new Error('LAYER_NOT_FOUND:' + compositionName + '/' + layerName);
  }
  if (!(layer instanceof AVLayer)) {
    throw new Error('LAYER_NOT_REPLACEABLE:' + layerName);
  }

  var footageItem = AssetImporter.importOrReuse(assetPath);
  layer.replaceSource(footageItem, true);
  return footageItem;
};
