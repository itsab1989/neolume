/* N.keys – Samsung-Orsay-Tastencodes (am TV verifiziert, docs/PHASE1-ERGEBNISSE.md) und Tastenkappen (SPEC 5.11) */
(function (N) {
  var CODES = {
    29443: 'ENTER', 88: 'RETURN', 29460: 'UP', 29461: 'DOWN', 4: 'LEFT', 5: 'RIGHT',
    108: 'RED', 20: 'GREEN', 21: 'YELLOW', 22: 'BLUE', 31: 'INFO', 75: 'TOOLS',
    71: 'PLAY', 74: 'PAUSE', 70: 'STOP', 72: 'FF', 69: 'RW', 68: 'CH_UP', 65: 'CH_DOWN', 652: 'SUBTITLE',
    17: '0', 101: '1', 98: '2', 6: '3', 8: '4', 9: '5', 10: '6', 12: '7', 13: '8', 14: '9'
  };
  N.keys = {
    name: function (code) { return CODES[code] || null; },
    isNav: function (k) { return k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT'; },
    isDigit: function (k) { return k !== null && k.length === 1 && k >= '0' && k <= '9'; },
    /* Tastenkappen: aufgedruckter Text, nie uebersetzt */
    cap: { INFO: 'INFO', TOOLS: 'TOOLS', EXIT: 'EXIT', DIGITS: '0–9', ENTER: 'OK' }
  };
})(N);
