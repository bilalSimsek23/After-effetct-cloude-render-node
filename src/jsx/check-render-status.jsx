// check-render-status.jsx — real Render Queue Item status check (Faz 8A).
//
// Lets WaitRenderStage distinguish "still rendering" from "failed and
// will never produce a file": file-only polling can't tell the
// difference (real testing hit this exactly — a corrupt source image
// failed the render immediately, but the output file simply never
// appeared, so file-stability polling waited the full timeout before
// reporting a misleading "timed out" error instead of the real failure).
//
// Beklenen payload: { renderQueueItemIndex: number, reportFile: string }
// Rapor: RQItemStatus'un sayısal değeri (örn. 3016=RENDERING, 3018=ERR_STOPPED, 3019=DONE).

(function () {
  var status = -1;
  var item = app.project.renderQueue.item(payload.renderQueueItemIndex);
  if (item) {
    status = item.status;
  }

  var reportFile = new File(payload.reportFile);
  reportFile.encoding = 'UTF-8';
  reportFile.open('w');
  reportFile.write(String(status));
  reportFile.close();
})();
