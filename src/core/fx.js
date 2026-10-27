/* N.fx – Tastenwiederholung (SPEC 5.1 Regel 8 / TECH-R12): bei schnellen Schritten inline
 * webkitTransition='none' NUR an den bewegten Elementen; nach 300 ms Ruhe zurueck. Reduzierte Bewegung: Klasse .rm am body. */
(function (N) {
  var list = [], timer = 0, fast = false, rm = false;
  function restore() {
    timer = 0;
    for (var i = 0; i < list.length; i++) list[i].style.webkitTransition = '';
    list = [];
  }
  N.fx = {
    /* wird pro Tastenschritt vom Router gesetzt */
    step: function (isFast) {
      fast = isFast;
      if (!isFast && list.length) restore();
      if (timer) clearTimeout(timer);
      timer = setTimeout(restore, 300);
    },
    isFast: function () { return fast; },
    /* Element wird gleich bewegt: bei fast ohne Uebergang */
    move: function (el) {
      if (!fast || !el) return;
      if (el.style.webkitTransition !== 'none') { el.style.webkitTransition = 'none'; list.push(el); }
    },
    reduced: function () { return rm; },
    setReduced: function (on) {
      rm = !!on;
      if (typeof document !== 'undefined' && document.body) N.util.cls(document.body, 'rm', rm);
    },
    /* Skalierung des Rings: bei reduzierter Bewegung ohne scale */
    scale: function (s) { return rm ? '' : ' scale(' + s + ')'; }
  };
})(N);
