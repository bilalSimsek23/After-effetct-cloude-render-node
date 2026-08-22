// save-project.jsx — real Save (Faz 8A + fallback Save As fix). After this
// runs, app.project.save() has genuinely written the current state to the
// project's file path.
//
// A project that After Effects had to convert from an older version on
// open (a real, reproducible case with real product templates - see
// AfterEffectsEngine.openProject()'s own docblock) never gets a file path
// association at all: AE explicitly keeps "the original file... unchanged"
// during conversion, which means the converted, in-memory project is
// file-path-less from the moment it opens, permanently, not as a transient
// race - app.project.save() can never succeed on it (there is no existing
// file path for a plain Save to write to). Confirmed empirically against a
// real project that needed conversion: app.project.file stays null forever
// after open, but app.project.save(File(fallbackPath)) (a real Save As)
// immediately gives it one, and every following plain save() then works
// normally - so that's exactly what this script does when there's no file
// path yet and a fallbackPath was supplied.
//
// Beklenen payload: { fallbackPath?: string }

(function () {
  if (!app.project) {
    throw new Error('NO_PROJECT_OPEN');
  }
  if (!app.project.file) {
    if (!payload.fallbackPath) {
      throw new Error('PROJECT_HAS_NO_FILE_PATH');
    }
    app.project.save(new File(payload.fallbackPath));
    return;
  }
  app.project.save();
})();
