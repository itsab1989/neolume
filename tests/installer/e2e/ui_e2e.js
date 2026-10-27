#!/usr/bin/env node
/* Browser end-to-end test of the setup web UI (real page, real HTTP, mocked plex.tv/PMS/GDM via mock_setup.py).
 * Drives headless Firefox over WebDriver BiDi (no extra npm packages; Node >= 22 for the built-in WebSocket).
 *   node tests/installer/e2e/ui_e2e.js [--shots DIR]
 * FIREFOX=/path/to/firefox and PYTHON=python3 can be overridden. Exit code 0 = all checks passed. */
'use strict';
var cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');

var FIREFOX = process.env.FIREFOX || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
var PYTHON = process.env.PYTHON || 'python3';
var SHOTS = (function () { var i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
var procs = [], profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-e2e-ff-'));
var errors = [], checks = 0;

function cleanup() { procs.forEach(function (p) { try { p.kill('SIGKILL'); } catch (e) {} }); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
function fail(msg) { console.error('FAIL: ' + msg); cleanup(); process.exit(1); }
function ok(cond, msg) { checks++; if (!cond) fail(msg); console.log('  ok  ' + msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function freePort() {
  return new Promise(function (res) { var s = net.createServer(); s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { res(p); }); }); });
}
function get(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) { var b = []; r.on('data', function (c) { b.push(c); }); r.on('end', function () { res({ status: r.statusCode, body: Buffer.concat(b) }); }); }).on('error', rej);
  });
}

function startMock() {
  return new Promise(function (res, rej) {
    var p = cp.spawn(PYTHON, [path.join(__dirname, 'mock_setup.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
    procs.push(p);
    var buf = '';
    p.stdout.on('data', function (d) {
      buf += d;
      var m = /READY (\S+)/.exec(buf);
      if (m) res({ proc: p, url: m[1], out: function () { return buf; } });
    });
    p.on('exit', function (c) { if (!/READY/.test(buf)) rej(new Error('mock exited ' + c)); });
  });
}

function bidi(port) {
  var ws, id = 0, pending = {}, listeners = [];
  function connect(tries) {
    return new Promise(function (res, rej) {
      ws = new WebSocket('ws://127.0.0.1:' + port + '/session');
      ws.onopen = function () { res(); };
      ws.onerror = function () { if (tries > 0) setTimeout(function () { connect(tries - 1).then(res, rej); }, 300); else rej(new Error('no BiDi')); };
      ws.onmessage = function (ev) {
        var m = JSON.parse(ev.data);
        if (m.id && pending[m.id]) { var p = pending[m.id]; delete pending[m.id]; if (m.type === 'error') p.rej(new Error(m.error + ': ' + m.message)); else p.res(m.result); }
        else if (m.type === 'event') listeners.forEach(function (l) { l(m); });
      };
    });
  }
  function send(method, params) {
    return new Promise(function (res, rej) { id++; pending[id] = { res: res, rej: rej }; ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
  }
  return { connect: function () { return connect(50); }, send: send, on: function (f) { listeners.push(f); }, close: function () { try { ws.close(); } catch (e) {} } };
}

async function main() {
  if (!fs.existsSync(FIREFOX) && FIREFOX.indexOf('/') >= 0) fail('Firefox not found: ' + FIREFOX);
  var mock = await startMock();
  console.log('setup UI (mocked plex.tv/PMS): ' + mock.url);
  var port = await freePort();
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("intl.accept_languages", "en-US");', 'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);', 'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");', 'user_pref("app.update.enabled", false);',
    'user_pref("network.proxy.type", 0);'].join('\n'));
  var ff = cp.spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--width', '1100', '--height', '1400'],
    { stdio: 'ignore' });
  procs.push(ff);
  var b = bidi(port);
  await b.connect();
  await b.send('session.new', { capabilities: {} });
  await b.send('session.subscribe', { events: ['log.entryAdded'] });
  b.on(function (m) {
    if (m.method === 'log.entryAdded' && (m.params.level === 'error' || /Content-Security-Policy|CSP/.test(m.params.text || ''))) errors.push(m.params.text);
  });
  var tree = await b.send('browsingContext.getTree', {});
  var ctx = tree.contexts[0].context;
  await b.send('browsingContext.navigate', { context: ctx, url: mock.url, wait: 'complete' });

  async function js(expr) {
    var r = await b.send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true });
    if (r.type === 'exception') throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.text));
    return r.result.value;
  }
  function text() { return js('document.body.innerText'); }
  async function waitText(s, ms) {
    var end = Date.now() + (ms || 10000), t = '';
    while (Date.now() < end) { t = await text(); if (t.indexOf(s) >= 0) return t; await sleep(150); }
    fail('timeout waiting for "' + s + '"; page:\n' + t.slice(0, 1500));
  }
  async function click(label, sel) {
    var done = await js('(function(){var L=' + JSON.stringify(label) + ';var els=[].slice.call(document.querySelectorAll(' + JSON.stringify(sel || 'button,[role=button],label') +
      '));var e=els.filter(function(x){return x.textContent.indexOf(L)>=0&&!x.disabled;})[0];if(!e)return false;e.click();return true;})()');
    if (!done) fail('nothing to click: ' + label + '\n' + (await text()).slice(0, 1200));
  }
  async function shot(name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    var r = await b.send('browsingContext.captureScreenshot', { context: ctx, origin: 'document' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  async function state() {
    return js('(function(){var m=/var CSRF = \'([^\']+)\'/.exec(document.documentElement.innerHTML);return fetch("/api/state",{method:"POST",' +
      'headers:{"Content-Type":"application/json","X-Neo-Csrf":m[1]},body:"{}"}).then(function(r){return r.text();});})()').then(function (s) { return JSON.parse(s).state; });
  }

  console.log('1. sign in');
  await waitText('Sign in with Plex');
  ok((await js('document.documentElement.lang')) !== '', 'page has a language');
  await shot('1-login');
  await click('Use a code on plex.tv/link');
  await waitText('abcdefghijklmnopqrstuvwxy');
  ok(true, 'link code shown');
  console.log('2. server');
  await waitText('Which Plex server should the TV use?', 15000);
  var t = await text();
  ok(t.indexOf('found on your network') >= 0, 'server found on the LAN (GDM)');
  ok(t.indexOf('Friend Server') >= 0 && t.indexOf('not your server') >= 0, 'foreign server explained');
  await shot('2-server');
  await click('Home Server', '[role=button]');
  console.log('3. profiles');
  await waitText('Which profiles should appear on the TV?');
  t = await text();
  ok(/Kid[\s\S]*2 libraries/.test(t) && t.indexOf('no access to this server') >= 0, 'profiles with library counts and missing share');
  await shot('3-profiles');
  await click('Next');
  console.log('4. summary');
  await waitText('Reset app PINs');
  // Weitere Server (optional): search, status + explanation, tick
  await click('Search shared servers');
  await waitText('Search again', 15000);
  t = await text();
  ok(t.indexOf('Friend Server') >= 0 && t.indexOf('not reachable right now') >= 0, 'shared server listed with its status');
  ok(t.indexOf('without encryption') >= 0, 'plain http to other servers explained');
  ok(t.indexOf('5.6.7.8') < 0, 'no addresses of other servers on the page');
  await click('Friend Server', 'label');
  await click('Set up the helper', 'label');
  await shot('4-summary');
  await click('Create app package');
  console.log('5. TV');
  await waitText('Ready – the TV can fetch the app now.');
  ok((await text()).indexOf('192.0.2.10') >= 0, 'computer address shown big for the TV');
  var st = await state();
  ok(st.package && st.package.helper === true && st.package.resetPins === false, 'package built with helper, PINs kept ' + JSON.stringify(st.package) + JSON.stringify(st.helper));
  ok(st.package.others.join() === 'Friend Server', 'chosen other server in the package');
  var wl = await get('http://127.0.0.1:' + st.sync.port + '/widgetlist.xml');
  var pkgName = (/<download>[^<]*\/([A-Za-z0-9_]+\.zip)<\/download>/.exec(wl.body.toString()) || [])[1];   // <widgetId>.zip of the brand
  ok(wl.status === 200 && !!pkgName, 'TV fetch widgetlist.xml');
  var zip = await get('http://127.0.0.1:' + st.sync.port + '/' + pkgName);
  ok(zip.status === 200 && zip.body.slice(0, 2).toString() === 'PK', 'TV fetch ' + pkgName);
  ok((await get('http://127.0.0.1:' + st.sync.port + '/../etc/passwd')).status === 404, 'traversal refused');
  await waitText('The app has arrived on the TV.', 6000);
  await shot('5-tv');
  ok(JSON.stringify(st).indexOf('Tok-') < 0, 'no token in the page state');
  await click('The app is on the TV');
  console.log('6. done + helper + update server');
  await waitText('Start helper');
  await click('Start helper');
  await waitText('Helper running on port');
  st = await state();
  var hello = await get('http://127.0.0.1:' + st.helper.port + '/neo-helper');
  ok(hello.status === 200 && JSON.parse(hello.body).name === 'plex-neo-helper', 'helper answers on its port');
  await click('Start update server');
  await waitText('running on port');
  await click('Clear access data from memory and finish');
  await waitText('Access data cleared');
  st = await state();
  ok(!st.loggedIn && !st.sync.running && st.helper.running, 'finish: tokens gone, sync off, helper keeps running');
  await shot('6-done');
  console.log('7. German + quit');
  await click('DE');
  await waitText('Programm beenden');
  ok((await text()).indexOf('Fertig – das Programm kann geschlossen werden') >= 0, 'German texts');
  await js('window.confirm = function () { return true; }, true');
  await click('Programm beenden');
  await waitText('Das Programm ist beendet');
  var exited = await new Promise(function (res) { var tm = setTimeout(function () { res(false); }, 5000); mock.proc.on('exit', function () { clearTimeout(tm); res(true); }); if (mock.proc.exitCode !== null) res(true); });
  ok(exited && /QUIT/.test(mock.out()), 'program ended via the Quit button');
  ok(errors.length === 0, 'no console errors / CSP violations' + (errors.length ? ': ' + errors.join(' | ') : ''));
  b.close();
  cleanup();
  console.log('\nAll ' + checks + ' checks passed.');
}

main().catch(function (e) { fail(e.stack || String(e)); });
