// Faz 5 iskeleti — bu işlem şu an AfterEffectsEngine.closeProject() üzerinden
// (mevcut, test edilmiş inline JSX ile) yürütülüyor. Bu dosya, ileride Close
// akışının da dosya-tabanlı JSX Runtime'a taşınması için ayrılmıştır.
// Beklenen payload: { markerFilePath?: string }
//
// markerFilePath verildiyse (yalnızca test/doğrulama amaçlı) — bkz.
// open-project.jsx'teki açıklama.
if (payload.markerFilePath) {
  var __marker = new File(payload.markerFilePath);
  __marker.open('w');
  __marker.write('close-project:skeleton');
  __marker.close();
}
