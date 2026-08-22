// Faz 5 iskeleti — gerçek proje açma implementasyonu Faz 6'da yazılacaktır.
// Beklenen payload: { projectFilePath: string, markerFilePath?: string }
// Faz 6: app.open(File(payload.projectFilePath));
//
// markerFilePath verildiyse (yalnızca test/doğrulama amaçlı): bu dosyanın
// gerçekten #include ile çalıştırıldığını Node tarafında doğrulanabilir
// kılmak için kendi adını bir dosyaya yazar. After Effects'in DoScript'i
// betiğin son ifadesinin değerini döndürmez (yalnızca bir durum kodu
// döndürür) — bu yüzden doğrulama dönüş değeri yerine bu dosya üzerinden
// yapılır.
if (payload.markerFilePath) {
  var __marker = new File(payload.markerFilePath);
  __marker.open('w');
  __marker.write('open-project:skeleton');
  __marker.close();
}
