/* N.LRU – O(1)-LRU (doppelt verkettete Liste + Objekt-Index) */
(function (N) {
  function LRU(max) { this.max = max || 100; this.clear(); }
  LRU.prototype.clear = function () { this.map = {}; this.head = null; this.tail = null; this.size = 0; };
  LRU.prototype._unlink = function (n) {
    if (n.p) n.p.n = n.n; else this.head = n.n;
    if (n.n) n.n.p = n.p; else this.tail = n.p;
    n.p = n.n = null;
  };
  LRU.prototype._push = function (n) { n.p = this.tail; n.n = null; if (this.tail) this.tail.n = n; else this.head = n; this.tail = n; };
  LRU.prototype.has = function (k) { return Object.prototype.hasOwnProperty.call(this.map, k); };
  LRU.prototype.get = function (k) {
    if (!this.has(k)) return undefined;
    var n = this.map[k]; this._unlink(n); this._push(n); return n.v;
  };
  LRU.prototype.set = function (k, v) {
    var n;
    if (this.has(k)) { n = this.map[k]; n.v = v; this._unlink(n); this._push(n); return; }
    n = { k: k, v: v, p: null, n: null }; this.map[k] = n; this._push(n); this.size++;
    while (this.size > this.max) { var h = this.head; this._unlink(h); delete this.map[h.k]; this.size--; }
  };
  LRU.prototype.del = function (k) { if (!this.has(k)) return; this._unlink(this.map[k]); delete this.map[k]; this.size--; };
  N.LRU = LRU;
})(N);
