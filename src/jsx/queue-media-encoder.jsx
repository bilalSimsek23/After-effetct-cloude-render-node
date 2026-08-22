// queue-media-encoder.jsx — real Render Queue rendering (Faz 8A).
//
// Runs against AFTER EFFECTS. Earlier real testing in this same phase
// tried handing the render off to Adobe Media Encoder via
// `app.project.renderQueue.queueInAME(true)` (the documented way to reach
// AME, since Media Encoder's own DoScript surface was independently found,
// in Faz 5/7, to reject a scripted #include-based call outright). That
// path was abandoned after further real testing here proved it
// unreliable at a deeper level: AME silently ignores the Output Module
// settings this script applies (confirmed AE-side via
// outputModule.getSettings() showing "Format: H.264" right after
// applyTemplate()) and instead renders with whatever preset a human last
// selected in AME's own UI — a real, verified gap with no scriptable
// bridge (Media Encoder's own Preset Browser presets don't even appear in
// outputModule.templates, so applyTemplate() can't select them either).
//
// The fix: render directly inside After Effects via
// `app.project.renderQueue.renderAsync()` instead — real testing
// confirmed this produces a genuine, correctly-encoded output file
// (verified via ffprobe: real H.264, correct duration/dimensions) using
// exactly the Output Module settings this script already controls
// reliably. Media Encoder is no longer part of the render path at all.
//
// Beklenen payload: { projectFilePath: string, outputFilePath: string, mediaEncoderPreset: string|null, reportFile: string, compositionName?: string|null, renderDurationSeconds?: number|null, watermarkText?: string|null, resolutionFactor?: string|null }
//
// watermarkText (HD onay akışı) - opsiyonel. Verilirse render edilecek
// comp'a, kuyruğa eklenmeden hemen önce, gerçek bir metin katmanı eklenir
// (yarı saydam, alt-orta). Bu katman diskteki .aep'e HİÇ kaydedilmez -
// SaveProjectStage bu script çalışmadan önce zaten çalışmış oluyor, ama
// sorun değil: her job kendi tek kullanımlık proje kopyasını kullanıyor ve
// AE render kuyruğu projenin bellekteki anlık haline göre render alıyor.
//
// resolutionFactor (HD onay akışı) - opsiyonel, best-effort. AE'nin Render
// Settings ("Resolution") ayarını değiştirmeye çalışır (Output Module'den
// ayrı bir ayar grubu) - gerçek bir hız kazanımı için. Tam anahtar/değer
// string'leri AE sürümüne/diline göre değişebileceğinden başarısızlık
// sessizce yutulur, render asla bu yüzden durdurulmaz.
//
// compositionName (Faz 8C) - opsiyonel. Verilmezse eski davranış aynen
// korunur (Project panelindeki ilk composition alınır - tek comp'lu
// sentetik test projeleri için yeterli). Verilirse TAM O İSİMDEKİ comp
// hedeflenir; bulunamazsa render yanlış comp'u sessizce almak yerine
// açıkça RENDER_COMPOSITION_NOT_FOUND ile durur - gerçek, çok comp'lu
// projelerde (bkz. scanner-manifest-metadata-contract.md,
// manifest.metadata.renderComposition) yanlış comp'un render edilmesi
// gözden kaçabilecek, saatler sürebilecek bir hata olurdu.
//
// renderDurationSeconds (Faz 8C) - opsiyonel. Verilirse render queue
// item'ın zaman aralığı 0'dan bu süreye kırpılır (comp'un tam süresi/work
// area'sı yerine); verilmezse eski davranış aynen korunur (AE'nin
// renderQueue.items.add() üzerinde varsayılan olarak seçtiği zaman
// aralığı, genelde comp'un work area'sı).
//
// Real testing (Faz 8A) found Output Module.file's actual final path can
// silently differ from what's assigned: AE rewrites the extension to
// match the applied (or, with none applied, ambient/last-used) template's
// real container format — e.g. assigning a ".mov" path came back ".mp4"
// or even ".gif" depending on this machine's AE render-queue history.
// So the real, final path is always read back from outputModule.file
// AFTER applying the template, and reported to Node via reportFile — the
// same "never trust DoScript's own return value, write a real file"
// pattern established since Faz 5.

(function () {
  if (!app.project) {
    throw new Error('NO_PROJECT_OPEN');
  }

  var comp = null;
  if (payload.compositionName) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var namedItem = app.project.item(i);
      if (namedItem instanceof CompItem && namedItem.name === payload.compositionName) {
        comp = namedItem;
        break;
      }
    }
    if (!comp) {
      throw new Error('RENDER_COMPOSITION_NOT_FOUND:' + payload.compositionName);
    }
  } else {
    for (var j = 1; j <= app.project.numItems; j++) {
      var firstItem = app.project.item(j);
      if (firstItem instanceof CompItem) {
        comp = firstItem;
        break;
      }
    }
  }
  if (!comp) {
    throw new Error('NO_COMPOSITION_FOUND');
  }

  if (payload.watermarkText) {
    try {
      var watermarkLayer = comp.layers.addText(payload.watermarkText);
      watermarkLayer.moveToBeginning();
      watermarkLayer.name = 'PratikTools Watermark';

      var textProp = watermarkLayer.property('Source Text');
      var textDocument = textProp.value;
      textDocument.fontSize = Math.max(12, Math.round(comp.width / 22));
      textDocument.fillColor = [1, 1, 1];
      textDocument.justification = ParagraphJustification.CENTER_JUSTIFY;
      textProp.setValue(textDocument);

      var transformGroup = watermarkLayer.property('Transform');
      transformGroup.property('Position').setValue([comp.width / 2, comp.height * 0.92]);
      transformGroup.property('Opacity').setValue(55);
    } catch (watermarkError) {
      // Never fail the whole render over a cosmetic watermark issue.
    }
  }

  var rqItem = app.project.renderQueue.items.add(comp);
  var rqItemIndex = app.project.renderQueue.numItems;
  var outputModule = rqItem.outputModule(1);

  if (payload.resolutionFactor) {
    try {
      var renderSettings = rqItem.getSettings(GetSettingsFormat.STRING_SETTABLE);
      renderSettings['Resolution'] = payload.resolutionFactor;
      rqItem.setSettings(renderSettings);
    } catch (resolutionError) {
      // Best-effort only (see file header) — falls back to full resolution.
    }
  }

  if (payload.renderDurationSeconds) {
    rqItem.timeSpanStart = 0;
    rqItem.timeSpanDuration = payload.renderDurationSeconds;
  }

  outputModule.file = new File(payload.outputFilePath);

  // Real testing (Faz 8A) found a mismatched template name (even a single
  // missing space) throws here but is easy to miss if swallowed silently
  // — an earlier version of this file did exactly that, and the queue
  // silently fell back to whatever ambient/last-used template happened to
  // be active (once, an Animated GIF one). So the outcome is now always
  // reported, never just discarded — Node logs a warning when it wasn't
  // applied, without failing the whole queue step over a missing preset
  // (a preset genuinely absent on some other render farm node shouldn't
  // be fatal).
  var templateStatus = 'NONE_REQUESTED';
  if (payload.mediaEncoderPreset) {
    try {
      outputModule.applyTemplate(payload.mediaEncoderPreset);
      templateStatus = 'OK';
    } catch (e) {
      templateStatus = 'FAILED:' + e.toString();
    }
  }

  var actualOutputFilePath = outputModule.file.fsName;

  // Pipe-delimited, not newline-delimited: real testing (Faz 8A) found
  // ExtendScript's File.write() emits '\r' (Macintosh-style) line endings
  // here regardless of host OS, which silently breaks a plain '\n' split
  // on Node's side.
  var reportFile = new File(payload.reportFile);
  reportFile.encoding = 'UTF-8';
  reportFile.open('w');
  reportFile.write(actualOutputFilePath + '|' + templateStatus + '|' + rqItemIndex);
  reportFile.close();

  // renderAsync() returns immediately — the actual encode continues
  // inside After Effects in the background. Node learns it's done the
  // same way it always has (WaitRenderStage polling the real output file
  // for stability), unaffected by which engine produced it.
  app.project.renderQueue.renderAsync();
})();
