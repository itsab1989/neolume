/* "Copy prompt" buttons: copy the text of the element named in data-copy. Without JavaScript the button stays hidden and
 * the prompt can be selected and copied by hand. */
(function () {
  var buttons = document.querySelectorAll('button[data-copy]');
  Array.prototype.forEach.call(buttons, function (btn) {
    var target = document.getElementById(btn.getAttribute('data-copy'));
    if (!target) return;
    var label = btn.textContent;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var text = target.textContent;
      function done(ok) {
        btn.textContent = ok ? 'Copied ✓' : 'Please select the text and copy it';
        setTimeout(function () { btn.textContent = label; }, 2500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        var r = document.createRange();
        r.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        done(ok);
      }
    });
  });
})();
