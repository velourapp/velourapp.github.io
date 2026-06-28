(function () {
  'use strict';

  var STORAGE_KEY = 'velour-lang';

  function detectLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'ru' || saved === 'en') return saved;
    } catch (e) {}
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('ru') === 0 ? 'ru' : 'en';
  }

  function applyLang(lang) {
    var html = document.documentElement;
    html.lang = lang;

    var title = html.getAttribute('data-title-' + lang);
    if (title) document.title = title;

    var desc = html.getAttribute('data-desc-' + lang);
    if (desc) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', desc);
    }

    var buttons = document.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.setAttribute('aria-pressed', btn.getAttribute('data-set-lang') === lang ? 'true' : 'false');
    }
  }

  function setLang(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyLang(lang);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-set-lang]');
    if (btn) setLang(btn.getAttribute('data-set-lang'));
  });

  applyLang(detectLang());
})();
