/* Velour — форма обращения в поддержку (блок на index.html, todo п.61).
 *
 * POST {API_BASE}/v1/support без авторизации: { message, key?, contact?, hp, lang }.
 * Ответ 201 { ok:true, ticket:'T-7Q2K' }; 429 rate_limited; 400 bad_request; сеть.
 * Ловушка для ботов `hp` — людям невидима; заполненную сервер молча принимает без тикета.
 * Ключ и контакт необязательны: без контакта человек получает номер обращения и команду /ticket для бота.
 */
(function () {
  'use strict';

  var form = document.getElementById('support-form');
  if (!form) return;

  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // ?api=prod работает ТОЛЬКО на localhost (как в buy.js). На сайте параметр игнорируется.
  var API_BASE = (!LOCAL || new URLSearchParams(location.search).get('api') === 'prod') ? 'https://api.velourff.com' : location.origin;
  var MIN = 10, MAX = 2000, CONTACT_MAX = 80;

  var T = {
    left:        { ru: 'осталось {n}', en: '{n} left' },
    tooShort:    { ru: 'ещё хотя бы {n}', en: 'at least {n} more' },
    sending:     { ru: 'Отправляем…', en: 'Sending…' },
    rate:        { ru: 'Слишком часто. Подожди немного и попробуй ещё раз.', en: 'Too many requests. Wait a little and try again.' },
    bad:         { ru: 'Сервер не принял обращение. Проверь текст и попробуй ещё раз.', en: 'The server did not accept the request. Check the text and try again.' },
    net:         { ru: 'Не отправилось. Напиши в канал поддержки или на почту — ссылки ниже.', en: 'It did not send. Write to the support channel or by email — links below.' },
    doneTitle:   { ru: 'Обращение {t} принято', en: 'Request {t} received' },
    doneNoCt:    { ru: 'Чтобы получить ответ в Телеграме, открой @velourmebot и отправь команду ниже. Поддержка не увидит твой Телеграм — только номер обращения.', en: 'To get a reply in Telegram, open @velourmebot and send the command below. Support will not see your Telegram — only the request number.' },
    doneCt:      { ru: 'Ответим на указанный контакт. Номер обращения на всякий случай сохрани.', en: 'We will reply to the contact you gave. Keep the request number just in case.' },
    copy:        { ru: 'Скопировать', en: 'Copy' },
    copied:      { ru: 'Скопировано', en: 'Copied' },
    another:     { ru: 'Написать ещё', en: 'Write another' }
  };
  function lang() { return document.documentElement.lang === 'ru' ? 'ru' : 'en'; }
  function t(k, v) { var s = (T[k] && (T[k][lang()] || T[k].en)) || k; if (v) Object.keys(v).forEach(function (x) { s = s.split('{' + x + '}').join(String(v[x])); }); return s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  var msg = form.querySelector('#sup-msg'), key = form.querySelector('#sup-key'), contact = form.querySelector('#sup-contact'),
      hp = form.querySelector('#sup-hp'), counter = form.querySelector('#sup-count'), btn = form.querySelector('#sup-send'),
      err = form.querySelector('#sup-error'), done = document.getElementById('support-done');
  var sending = false, last = null;   // last = { ticket, contact } для перерисовки при смене языка

  function refresh() {
    var n = msg.value.trim().length;
    counter.textContent = n < MIN ? t('tooShort', { n: MIN - n }) : t('left', { n: Math.max(0, MAX - n) });
    btn.disabled = sending || n < MIN || n > MAX;
  }
  msg.addEventListener('input', refresh);
  msg.setAttribute('maxlength', String(MAX));
  contact.setAttribute('maxlength', String(CONTACT_MAX));

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;                           // второй клик до ответа — не второй тикет
    var text = msg.value.trim();
    if (text.length < MIN || text.length > MAX) { refresh(); return; }
    sending = true; err.hidden = true; btn.disabled = true;
    var orig = btn.innerHTML; btn.textContent = t('sending');
    var body = { message: text, hp: hp.value || '', lang: lang() };
    var k = key.value.trim(); if (k) body.key = k.slice(0, 200);
    var c = contact.value.trim(); if (c) body.contact = c.slice(0, CONTACT_MAX);

    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    fetch(API_BASE + '/v1/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (res) { return res.text().then(function (txt) { var d = null; try { d = txt ? JSON.parse(txt) : null; } catch (x) {} return { status: res.status, data: d }; }); })
      .then(function (r) {
        if (r.status === 201 && r.data && r.data.ok && r.data.ticket) { last = { ticket: String(r.data.ticket), contact: !!c }; renderDone(); return; }
        err.textContent = r.status === 429 ? t('rate') : r.status === 400 ? t('bad') : t('net'); err.hidden = false;
      })
      .catch(function () { err.textContent = t('net'); err.hidden = false; })
      .finally(function () { if (timer) clearTimeout(timer); sending = false; btn.innerHTML = orig; refresh(); });
  });

  function renderDone() {
    if (!last) return;
    var cmd = '/ticket ' + last.ticket;
    done.innerHTML = '<div class="sup-done-mark" aria-hidden="true">✓</div>'
      + '<h3>' + esc(t('doneTitle', { t: last.ticket })) + '</h3>'
      + '<p>' + esc(last.contact ? t('doneCt') : t('doneNoCt')) + '</p>'
      + (last.contact ? '' : '<div class="buy-row"><code class="mono sup-cmd">' + esc(cmd) + '</code>'
        + '<button type="button" class="btn btn-secondary btn-copy" data-copy-text="' + esc(cmd) + '">' + esc(t('copy')) + '</button>'
        + '<a class="btn btn-primary" href="https://t.me/velourmebot">@velourmebot</a></div>')
      + '<p><button type="button" class="btn btn-ghost" id="sup-again">' + esc(t('another')) + '</button></p>';
    form.hidden = true; done.hidden = false;
    done.querySelector('#sup-again').addEventListener('click', function () { last = null; done.hidden = true; form.hidden = false; form.reset(); refresh(); msg.focus(); });
  }

  done.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy-text]'); if (!b) return;
    var txt = b.getAttribute('data-copy-text');
    var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(txt) : Promise.reject();
    p.then(function () { var o = b.textContent; b.textContent = t('copied'); b.classList.add('is-copied'); setTimeout(function () { b.textContent = o; b.classList.remove('is-copied'); }, 1500); }).catch(function () {});
  });

  new MutationObserver(function () { refresh(); if (last && !done.hidden) renderDone(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  refresh();
})();
