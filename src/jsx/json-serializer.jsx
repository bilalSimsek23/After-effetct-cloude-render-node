// json-serializer.jsx — shared, minimal JSON read/write for ExtendScript
// (Faz 8B; extracted from apply-variables.jsx, where this was first
// written).
//
// Real testing (Faz 8A) found this After Effects' ExtendScript engine has
// no native `JSON` global at all (`typeof JSON === 'undefined'`), unlike
// what's commonly assumed for modern AE. Every JSX entry point that needs
// to read or write structured data for Node #include's this file instead
// of re-implementing it.
//
// Not wrapped in its own IIFE: #include is textual inclusion, so these
// become real functions in whatever scope includes this file (matching
// asset-importer.jsx's own pattern).

function readJsonFile(path) {
  var f = new File(path);
  if (!f.exists) {
    throw new Error('JSON_FILE_NOT_FOUND:' + path);
  }
  f.encoding = 'UTF-8';
  f.open('r');
  var content = f.read();
  f.close();
  if (typeof JSON !== 'undefined' && JSON.parse) {
    return JSON.parse(content);
  }
  return eval('(' + content + ')');
}

function toJsonString(value) {
  if (value === null || typeof value === 'undefined') {
    return 'null';
  }
  var type = typeof value;
  if (type === 'string') {
    return jsonEscapeString(value);
  }
  if (type === 'number' || type === 'boolean') {
    return String(value);
  }
  if (value instanceof Array) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(toJsonString(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  var pairs = [];
  for (var key in value) {
    if (value.hasOwnProperty(key)) {
      pairs.push(jsonEscapeString(key) + ':' + toJsonString(value[key]));
    }
  }
  return '{' + pairs.join(',') + '}';
}

function jsonEscapeString(str) {
  var escaped = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return '"' + escaped + '"';
}

function writeJsonFile(path, data) {
  var f = new File(path);
  f.encoding = 'UTF-8';
  f.open('w');
  f.write(toJsonString(data));
  f.close();
}
