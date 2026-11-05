'use strict';
/* Pruefung der Senderdaten fuer Geraete ohne TLS 1.2 (TV 2014, caps.tls12 false; SPEC LIVE-12, TV-Befund 05.11.: RTVE 24h).
 * Netz-Pruefung, nicht Teil von npm test (Sender aendern ihre Server): node tools/live_tls.js
 * Je Host aus src/live/channels.js `hosts`: Handschlag mit hoechstens TLS 1.1. Je Sender ohne Feld tls12 muss der TV die Adresse
 * erreichen: entweder der Host kann TLS 1.1, oder er steht in httpHosts und die Master-Playlist ueber http nennt nur relative bzw.
 * http-Adressen (absolute https-Varianten auf einem Host ohne TLS 1.1 scheitern sonst nach ~15 s). Sender mit sep laufen am TV
 * ueber den Helfer (Python, TLS 1.2) und brauchen das nicht. Ausgabe: Befunde; Exit 1, wenn ein Sender tls12 braucht bzw. es
 * unnoetig hat. */
var tls = require('tls'), http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..');
function data() {
  var ctx = { N: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/live/channels.js'), 'utf8'), ctx);
  return ctx.N.liveData;
}
function tls11(host) {
  return new Promise(function (res) {
    var done = false, s = tls.connect({ host: host, port: 443, servername: host, minVersion: 'TLSv1', maxVersion: 'TLSv1.1',
      ciphers: 'DEFAULT@SECLEVEL=0' }, function () { fin(true); });
    function fin(v) { if (!done) { done = true; s.destroy(); res(v); } }
    s.on('error', function () { fin(false); });
    s.setTimeout(10000, function () { fin(false); });
  });
}
function get(url) {
  return new Promise(function (res) {
    var r = http.get(url, { timeout: 10000 }, function (rs) {
      var b = ''; rs.setEncoding('utf8');
      rs.on('data', function (c) { if (b.length < 200000) b += c; });
      rs.on('end', function () { res({ status: rs.statusCode, body: b }); });
    });
    r.on('error', function () { res({ status: 0, body: '' }); });
    r.on('timeout', function () { r.destroy(); });
  });
}
function host(u) { var m = /^https?:\/\/([^/:?#]+)/i.exec(u); return m ? m[1].toLowerCase() : ''; }
/* braucht der Sender am TV ohne TLS 1.2 einen Weg, den es nicht gibt? -> Grund oder '' */
async function need(ch, D, ok) {
  var h = host(ch.url);
  if (!(h in ok)) ok[h] = await tls11(h);
  if (ok[h]) return '';
  if (!D.httpHosts.some(function (x) { return h === x || h.slice(-x.length - 1) === '.' + x; })) return h + ' kann kein TLS 1.1 und steht nicht in httpHosts';
  var r = await get(ch.url.replace(/^https:/i, 'http:'));
  if (r.status !== 200) return 'http-Master ' + r.status;
  var abs = r.body.split(/\r?\n/).filter(function (l) { return /^https:\/\//i.test(l.trim()) || /URI="https:/i.test(l); });
  for (var i = 0; i < abs.length; i++) {
    var m = /https:\/\/[^"\s]+/i.exec(abs[i]), ah = host(m[0]);
    if (!(ah in ok)) ok[ah] = await tls11(ah);
    if (!ok[ah]) return 'Master ueber http nennt https-Adressen auf ' + ah + ' (kein TLS 1.1)';
  }
  return '';
}
async function main() {
  var D = data(), ok = {}, bad = 0;
  for (var i = 0; i < D.hosts.length; i++) { ok[D.hosts[i]] = await tls11(D.hosts[i]); console.log((ok[D.hosts[i]] ? 'TLS1.1 ja   ' : 'TLS1.1 nein ') + D.hosts[i]); }
  for (var j = 0; j < D.channels.length; j++) {
    var ch = D.channels[j];
    if (ch.sep) continue;                                           // am TV ueber den Helfer
    var why = await need(ch, D, ok);
    if (why && !ch.tls12) { bad++; console.log('FEHLT tls12: ' + ch.id + ' – ' + why); }
    else if (!why && ch.tls12) { bad++; console.log('UNNOETIG tls12: ' + ch.id + ' (am TV erreichbar)'); }
  }
  console.log(bad ? bad + ' Befund(e)' : 'live_tls: Daten stimmen');
  process.exit(bad ? 1 : 0);
}
main();
