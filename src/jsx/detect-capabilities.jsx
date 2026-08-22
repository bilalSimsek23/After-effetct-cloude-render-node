// detect-capabilities.jsx — real, one-time Adobe runtime capability probe
// (Faz 8B).
//
// Every flag here is a real, executed check against this machine's actual
// AE build — never assumed from a version number. Run once during node
// registration (see AdobeRuntimeCapabilityProvider); never re-probed per
// job.
//
// Beklenen payload: { reportFile: string }

#include "json-serializer.jsx"

(function () {
  var result = {
    supportsJSON: typeof JSON !== 'undefined' && typeof JSON.parse === 'function',
    supportsFontsApi:
      typeof app.fonts !== 'undefined' && typeof app.fonts.getFontsByPostScriptName === 'function',
    supportsRenderQueue: false,
    supportsRenderQueueStatusEnum:
      typeof RQItemStatus !== 'undefined' &&
      typeof RQItemStatus.DONE === 'number' &&
      typeof RQItemStatus.ERR_STOPPED === 'number',
    installedOutputModuleTemplates: [],
    probeError: null,
  };

  var createdProject = false;
  var createdComp = false;
  var comp = null;
  var rqItem = null;

  try {
    if (!app.project) {
      app.newProject();
      createdProject = true;
    }

    for (var i = 1; i <= app.project.numItems; i++) {
      if (app.project.item(i) instanceof CompItem) {
        comp = app.project.item(i);
        break;
      }
    }
    if (!comp) {
      comp = app.project.items.addComp('CapabilityProbeComp', 4, 4, 1, 1, 30);
      createdComp = true;
    }

    result.supportsRenderQueue = typeof app.project.renderQueue.renderAsync === 'function';

    rqItem = app.project.renderQueue.items.add(comp);
    var outputModule = rqItem.outputModule(1);
    for (var t = 0; t < outputModule.templates.length; t++) {
      result.installedOutputModuleTemplates.push(outputModule.templates[t]);
    }
  } catch (e) {
    result.probeError = e.toString();
  }

  // Real cleanup — this probe never leaves a temporary item/comp/project
  // behind, whether or not it hit an error above.
  if (rqItem) {
    try {
      rqItem.remove();
    } catch (removeError) {
      // Already gone or never fully created — nothing further to clean up.
    }
  }
  if (createdComp && comp) {
    try {
      comp.remove();
    } catch (removeError) {
      // Already gone — ignore.
    }
  }
  if (createdProject) {
    try {
      app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    } catch (closeError) {
      // Nothing more we can do — report file below still carries the real result.
    }
  }

  writeJsonFile(payload.reportFile, result);
})();
