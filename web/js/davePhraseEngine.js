/* ============================================================
   Dave Phrase Engine (LOCAL / OFFLINE / GLOBAL)
   ============================================================ */

(function (window) {

  function DavePhraseEngine() {
    this.bank = null;
  }

  DavePhraseEngine.prototype.load = async function () {
    if (this.bank) return;
    const res = await fetch("/dave_phrases.json");
    this.bank = await res.json();
    console.log("🧠 Dave phrases loaded");
  };

  // ---------- helpers ----------

  DavePhraseEngine.prototype.getBand = function (score) {
    return this.bank.meta.bands.find(
      b => score >= b.min && score <= b.max
    )?.id || "okay";
  };

  DavePhraseEngine.prototype.pickFirst = function (arr) {
    return arr && arr.length ? arr[0] : "—";
  };

  // ---------- public API ----------

  DavePhraseEngine.prototype.overall = function (score) {
    const band = this.getBand(score);
    return this.pickFirst(this.bank.overall?.[band]);
  };

  DavePhraseEngine.prototype.category = function (key, score) {
    const cat = this.bank.categories?.[key];
    if (!cat) return "—";
    const band = this.getBand(score);
    return this.pickFirst(cat.phrases?.[band]);
  };

  // 🔥 expose globally
  window.DavePhraseEngine = DavePhraseEngine;

})(window);
