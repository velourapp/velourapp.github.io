/* Velour — страница оплаты (buy.html).
 *
 * Один механизм на всех: человек вставляет ключ подписки, сервер поднимает тир у ЭТОГО ключа.
 * Контракт прокси (финальный, 2026-10-25): все вызовы POST + `Authorization: Bearer <ключ>`;
 *   /v1/quota, /v1/orders, /v1/orders/list, /v1/orders/status, /v1/orders/txid, /v1/orders/claim.
 * Реквизиты (адрес, сумма, комментарий) приходят ТОЛЬКО с сервера — в этом файле их нет и быть не должно.
 * Ключ живёт в памяти вкладки и никуда не сохраняется: перезагрузила страницу — вставь снова,
 * открытые заказы сервер покажет по ключу.
 */
(function () {
  'use strict';

  // Адрес API зашит. Единственное исключение — локальный мок для проверки страницы (localhost):
  // подменять адрес через параметры ссылки нельзя — это была бы дверь для фишинга.
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // ?api=prod работает ТОЛЬКО на localhost: прогнать страницу с мока против боевого API. На сайте параметр игнорируется.
  var API_BASE = (!LOCAL || new URLSearchParams(location.search).get('api') === 'prod') ? 'https://api.velourff.com' : location.origin;
  var POLL_MS = 10000;          // лимит прокси — 20 запросов в минуту на ключ
  var OPEN = { pending: 1, checking: 1, awaiting_review: 1 };
  var TIER_NAME = { lite: 'Lite', base: 'BASE', pro: 'PRO' };

  // ── Словарь динамических строк (статика страницы — в HTML через data-lang) ─────────────
  var T = {
    checking:        { ru: 'Проверяем…', en: 'Checking…' },
    keyBad:          { ru: 'Ключ не найден. Проверь, что он скопирован целиком — обычно это одна строка без пробелов.', en: 'Key not found. Make sure you copied it whole — it is usually a single line with no spaces.' },
    keyRevoked:      { ru: 'Этот ключ отключён. Напиши в поддержку — разберёмся.', en: 'This key has been disabled. Contact support and we will sort it out.' },
    netFail:         { ru: 'Сервер не ответил. Проверь соединение и попробуй ещё раз.', en: 'The server did not respond. Check your connection and try again.' },
    rateLimited:     { ru: 'Слишком много запросов. Подожди минуту.', en: 'Too many requests. Wait a minute.' },
    stTrial:         { ru: 'Пробный период до {date}', en: 'Trial until {date}' },
    stActive:        { ru: '{tier} до {date}', en: '{tier} until {date}' },
    stExpired:       { ru: 'Подписка закончилась', en: 'Subscription has ended' },
    stPrepaid:       { ru: 'оплачено вперёд: {n}', en: 'paid ahead: {n}' },
    stUsed:          { ru: 'использовано {used} из {limit}', en: '{used} of {limit} used' },
    resumeTitle:     { ru: 'Есть незавершённая оплата', en: 'You have an unfinished payment' },
    resumeLine:      { ru: '{tier} через {method}, создана {when}', en: '{tier} via {method}, created {when}' },
    resumeGo:        { ru: 'Продолжить', en: 'Continue' },
    resumeNew:       { ru: 'Начать заново', en: 'Start over' },
    noteQueue:       { ru: 'Сейчас идёт оплаченный месяц до {date}. Новая оплата встанет в очередь и начнётся сама, когда он кончится.', en: 'A paid month is running until {date}. A new payment will queue up and start on its own when it ends.' },
    noteQueueN:      { ru: 'Уже оплачено вперёд: {n}.', en: 'Already paid ahead: {n}.' },
    noteNow:         { ru: 'Начнётся сразу после оплаты.', en: 'Starts right after payment.' },
    curTag:          { ru: 'сейчас у тебя', en: 'your current plan' },
    mUnavailable:    { ru: 'Этот способ сейчас недоступен — выбери другой или попробуй позже.', en: 'This method is unavailable right now — pick another or try again later.' },
    tooMany:         { ru: 'Слишком много открытых счетов на этом ключе. Дождись, пока старые истекут, или продолжи один из них.', en: 'Too many open invoices on this key. Wait for the old ones to expire, or continue one of them.' },
    payGram:         { ru: 'Оплата в gram', en: 'Pay with gram' },
    payUsdt:         { ru: 'Оплата USDT (TRC-20)', en: 'Pay with USDT (TRC-20)' },
    payPaxum:        { ru: 'Оплата через Paxum', en: 'Pay via Paxum' },
    fAmount:         { ru: 'Сумма', en: 'Amount' },
    fAddress:        { ru: 'Адрес', en: 'Address' },
    fComment:        { ru: 'Комментарий к переводу', en: 'Transfer comment' },
    fRecipient:      { ru: 'Получатель (Paxum)', en: 'Recipient (Paxum)' },
    fReference:      { ru: 'Код в комментарии платежа', en: 'Code for the payment comment' },
    rateLine:        { ru: '≈ ${usd} по курсу на момент счёта. Курс держится один час.', en: '≈ ${usd} at the rate when the invoice was made. The rate holds for one hour.' },
    usdLine:         { ru: '= ${usd}', en: '= ${usd}' },
    copy:            { ru: 'Скопировать', en: 'Copy' },
    copied:          { ru: 'Скопировано', en: 'Copied' },
    openWallet:      { ru: 'Открыть в кошельке', en: 'Open in wallet' },
    warnGram:        { ru: 'Комментарий обязателен: по нему мы находим твой перевод. Без комментария платёж не привяжется к заказу.', en: 'The comment is required: it is how we find your transfer. Without it the payment will not be matched to the order.' },
    warnUsdt:        { ru: 'Переводи ровно эту сумму и только в сети TRC-20. По сумме мы узнаём твой перевод, поэтому она должна дойти точно. Если биржа вычитает комиссию из суммы, укажи при отправке столько, чтобы дошло ровно {amount}. Другая сеть — потеря средств.', en: 'Send exactly this amount, and only on the TRC-20 network. We recognise your transfer by the amount, so it must arrive exactly. If your exchange deducts a fee from the amount, enter enough so that exactly {amount} arrives. A different network means lost funds.' },
    warnPaxum:       { ru: 'Укажи этот код в комментарии к переводу — по нему мы найдём платёж. Подтверждаем вручную, обычно в течение дня.', en: 'Put this code in the transfer comment — that is how we find the payment. We confirm by hand, usually within a day.' },
    waiting:         { ru: 'Ждём перевод. Проверяем каждые 10 секунд.', en: 'Waiting for the transfer. Checking every 10 seconds.' },
    waitingTx:       { ru: 'Проверяем перевод в сети…', en: 'Checking the transfer on the network…' },
    waitingReview:   { ru: 'Заявка принята. Проверяем вручную — обычно в течение дня.', en: 'Request received. We are checking it by hand — usually within a day.' },
    closeOk:         { ru: 'Страницу можно закрыть: когда платёж дойдёт, подписка включится сама. Чтобы вернуться к этому счёту, открой страницу и вставь ключ ещё раз.', en: 'You can close this page: once the payment arrives, the subscription switches on by itself. To return to this invoice, open the page and paste your key again.' },
    timer:           { ru: 'Счёт действует ещё {t}', en: 'Invoice valid for {t}' },
    txLabel:         { ru: 'После перевода вставь ID транзакции (TxID)', en: 'After the transfer, paste the transaction ID (TxID)' },
    txCheck:         { ru: 'Проверить', en: 'Check' },
    txBad:           { ru: 'Это не похоже на ID транзакции: нужны 64 знака (цифры и буквы a–f).', en: 'That does not look like a transaction ID: it should be 64 characters (digits and letters a–f).' },
    noteLabel:       { ru: 'Номер платежа Paxum (если есть)', en: 'Paxum payment number (if any)' },
    claimBtn:        { ru: 'Я оплатила', en: 'I have paid' },
    expired:         { ru: 'Счёт истёк, оплата по нему уже не привяжется.', en: 'This invoice has expired; a payment to it will no longer be matched.' },
    newInvoice:      { ru: 'Создать новый счёт', en: 'Create a new invoice' },
    rejected:        { ru: 'Платёж не подтверждён.', en: 'The payment was not confirmed.' },
    support:         { ru: 'Если ты уверена, что оплатила, напиши в поддержку с данными перевода.', en: 'If you are sure you paid, contact support with your transfer details.' },
    doneTitle:       { ru: 'Подписка {tier} оплачена', en: '{tier} subscription paid' },
    doneNow:         { ru: 'Действует до {date}.', en: 'Active until {date}.' },
    doneQueued:      { ru: 'Оплата встала в очередь: начнётся {date}, когда кончится текущий месяц. Оплачено вперёд: {n}.', en: 'The payment is queued: it starts on {date}, when the current month ends. Paid ahead: {n}.' },
    mName:           { gram: { ru: 'gram', en: 'gram' }, usdt: { ru: 'USDT', en: 'USDT' }, paxum: { ru: 'Paxum', en: 'Paxum' } },
    reason: {
      tx_not_found:    { ru: 'Транзакция не найдена в сети. Проверь ID или подожди пару минут.', en: 'Transaction not found on the network. Check the ID or wait a couple of minutes.' },
      tx_unconfirmed:  { ru: 'Транзакция ещё не подтверждена сетью. Попробуй через минуту.', en: 'The transaction is not yet confirmed by the network. Try again in a minute.' },
      tx_failed:       { ru: 'Транзакция не прошла в сети.', en: 'The transaction failed on the network.' },
      not_usdt:        { ru: 'Это перевод не в USDT.', en: 'This transfer is not in USDT.' },
      wrong_recipient: { ru: 'Перевод ушёл на другой адрес.', en: 'The transfer went to a different address.' },
      wrong_amount:    { ru: 'Сумма не совпала. Должно дойти ровно столько, сколько указано в счёте.', en: 'The amount does not match. Exactly the invoiced amount must arrive.' },
      tx_before_order: { ru: 'Эта транзакция старше счёта.', en: 'This transaction is older than the invoice.' },
      tx_used:         { ru: 'Эта транзакция уже засчитана за другой заказ.', en: 'This transaction has already been counted for another order.' },
      rejected:        { ru: 'Платёж отклонён при проверке.', en: 'The payment was rejected on review.' }
    }
  };

  function lang() { return document.documentElement.lang === 'ru' ? 'ru' : 'en'; }
  function t(key, vars) {
    var node = T[key]; if (!node) return key;
    var s = node[lang()] || node.en || '';
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }
  function tReason(code) { var r = T.reason[code]; return r ? (r[lang()] || r.en) : ''; }
  function tMethod(m) { var n = T.mName[m]; return n ? (n[lang()] || n.en) : m; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-GB', opts);
  }
  function fmtWhen(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }

  // ── API ───────────────────────────────────────────────────────────────────────────────
  function api(path, body) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var code = (data && data.error && data.error.code) || (res.status === 429 ? 'rate_limited' : 'http_' + res.status);
          var err = new Error(code); err.status = res.status; err.code = code; err.data = data; throw err;
        }
        return data;
      });
    }).catch(function (e) {
      if (!e.status) { var ne = new Error('net'); ne.code = 'net'; throw ne; }
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function errText(e) {
    if (e.code === 'net') return t('netFail');
    if (e.status === 401) return t('keyBad');
    if (e.status === 403) return t('keyRevoked');
    if (e.status === 429 && e.code === 'too_many_orders') return t('tooMany');
    if (e.status === 429) return t('rateLimited');
    if (e.status === 503) return t('mUnavailable');
    return (e.data && e.data.error && e.data.error.message) || t('netFail');
  }

  // ── Состояние ─────────────────────────────────────────────────────────────────────────
  var state = { key: '', quota: null, expired: false, openOrders: [], tier: null, method: null, order: null, step: 'key' };
  var pollTimer = null, tickTimer = null;

  // ── Шаги ──────────────────────────────────────────────────────────────────────────────
  var ORDER = ['key', 'tier', 'method', 'pay'];
  function showStep(name) {
    state.step = name;
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    var idx = ORDER.indexOf(name === 'done' ? 'pay' : name);
    document.querySelectorAll('.buy-steps li').forEach(function (li, i) {
      li.classList.toggle('is-current', i === idx && name !== 'done');
      li.classList.toggle('is-done', i < idx || name === 'done');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Шаг 1: ключ ───────────────────────────────────────────────────────────────────────
  var keyForm = $('#key-form'), keyInput = $('#key-input'), keyBtn = $('#key-check'), keyErr = $('#key-error'), keyStatus = $('#key-status');

  keyForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var k = keyInput.value.trim();
    if (!k) return;
    state.key = k; state.quota = null; state.expired = false; state.openOrders = [];
    keyErr.hidden = true; keyStatus.hidden = true;
    keyBtn.disabled = true; setLabel(keyBtn, t('checking'));
    api('/v1/quota').then(function (q) {
      state.quota = q || {};
    }).catch(function (e) {
      if (e.status === 402) { state.expired = true; state.quota = (e.data && e.data.quota) || {}; return; }
      throw e;
    }).then(function () {
      return api('/v1/orders/list').then(function (r) {
        state.openOrders = ((r && r.orders) || []).filter(function (o) { return OPEN[o.status]; });
      }).catch(function () { state.openOrders = []; });   // список не критичен: без него просто без «продолжить»
    }).then(function () {
      renderKeyStatus();
      if (!state.openOrders.length) { renderTier(); showStep('tier'); }
    }).catch(function (e) {
      keyErr.textContent = errText(e); keyErr.hidden = false;
    }).finally(function () {
      keyBtn.disabled = false; restoreLabels(keyBtn);
    });
  });

  function renderKeyStatus() {
    if (!state.key || (!state.quota && !state.expired)) { keyStatus.hidden = true; return; }
    var q = state.quota || {}, pill, cls;
    if (state.expired) { pill = t('stExpired'); cls = 'is-warn'; }
    else if (q.tier === 'lite') { pill = t('stTrial', { date: fmtDate(q.periodEnd) }); cls = 'is-ok'; }
    else { pill = t('stActive', { tier: TIER_NAME[q.tier] || q.tier, date: fmtDate(q.periodEnd) }); cls = 'is-ok'; }
    var extra = [];
    if (q.prepaid && q.prepaid.count) extra.push(t('stPrepaid', { n: q.prepaid.count }));
    if (!state.expired && q.limit) extra.push(t('stUsed', { used: q.used || 0, limit: q.limit }));
    var html = '<span class="pill">' + esc(pill) + '</span>' + (extra.length ? '<span>' + esc(extra.join(' · ')) + '</span>' : '');
    if (state.openOrders.length) {
      html += '<div style="flex-basis:100%"><strong>' + esc(t('resumeTitle')) + '</strong></div>';
      state.openOrders.forEach(function (o, i) {
        html += '<div style="flex-basis:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
          + '<span>' + esc(t('resumeLine', { tier: TIER_NAME[o.tier] || o.tier, method: tMethod(o.method), when: fmtWhen(o.createdAt) })) + '</span>'
          + '<button type="button" class="btn btn-secondary btn-copy" data-resume="' + i + '">' + esc(t('resumeGo')) + '</button>'
          + (i === 0 ? '<button type="button" class="btn btn-ghost btn-copy" data-resume-new="1">' + esc(t('resumeNew')) + '</button>' : '')
          + '</div>';
      });
    }
    keyStatus.className = 'buy-status ' + cls; keyStatus.innerHTML = html; keyStatus.hidden = false;
  }
  keyStatus.addEventListener('click', function (e) {
    var b = e.target.closest('[data-resume]'); var n = e.target.closest('[data-resume-new]');
    if (b) { state.order = state.openOrders[+b.getAttribute('data-resume')]; state.tier = state.order.tier; state.method = state.order.method; renderPay(); showStep('pay'); startPoll(); }
    else if (n) { renderTier(); showStep('tier'); }
  });

  // ── Шаг 2: тариф ──────────────────────────────────────────────────────────────────────
  var tierNext = $('#tier-next'), tierNote = $('#tier-note');
  function renderTier() {
    var q = state.quota || {};
    document.querySelectorAll('.buy-option[data-tier]').forEach(function (opt) {
      var tag = opt.querySelector('.is-current-tag'); if (tag) tag.remove();
      if (!state.expired && q.tier === opt.getAttribute('data-tier')) {
        var s = document.createElement('span'); s.className = 'is-current-tag'; s.textContent = t('curTag'); opt.appendChild(s);
      }
    });
    var note = '';
    if (!state.expired && q.tier && q.tier !== 'lite' && q.periodEnd) {
      note = t('noteQueue', { date: fmtDate(q.periodEnd) });
      if (q.prepaid && q.prepaid.count) note += ' ' + t('noteQueueN', { n: q.prepaid.count });
    } else note = t('noteNow');
    tierNote.textContent = note;
    var pre = state.tier || (new URLSearchParams(location.search).get('tier') || '').toLowerCase();
    if (pre === 'base' || pre === 'pro') { var r = $('input[name="tier"][value="' + pre + '"]'); if (r) { r.checked = true; state.tier = pre; } }
    tierNext.disabled = !state.tier;
  }
  document.querySelectorAll('input[name="tier"]').forEach(function (r) { r.addEventListener('change', function () { state.tier = r.value; tierNext.disabled = false; }); });
  tierNext.addEventListener('click', function () { renderMethod(); showStep('method'); });

  // ── Шаг 3: способ ─────────────────────────────────────────────────────────────────────
  var methodNext = $('#method-next'), methodErr = $('#method-error');
  function renderMethod() {
    methodErr.hidden = true;
    var r = state.method && $('input[name="method"][value="' + state.method + '"]'); if (r) r.checked = true;
    methodNext.disabled = !state.method;
  }
  document.querySelectorAll('input[name="method"]').forEach(function (r) { r.addEventListener('change', function () { state.method = r.value; methodNext.disabled = false; methodErr.hidden = true; }); });
  methodNext.addEventListener('click', function () {
    if (!state.tier || !state.method) return;
    methodNext.disabled = true; methodErr.hidden = true;
    api('/v1/orders', { tier: state.tier, method: state.method }).then(function (r) {
      state.order = r.order; renderPay(); showStep('pay'); startPoll();
    }).catch(function (e) {
      methodErr.textContent = errText(e); methodErr.hidden = false;
      if (e.status === 503) { var opt = $('.buy-option[data-method="' + state.method + '"]'); if (opt) opt.classList.add('is-disabled'); }
    }).finally(function () { methodNext.disabled = !state.method; });
  });
  document.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { showStep(b.getAttribute('data-back')); }); });

  // ── Шаг 4: оплата ─────────────────────────────────────────────────────────────────────
  var payTitle = $('#pay-title'), payBody = $('#pay-body');

  function field(label, value, big) {
    return '<div class="pay-field"><div class="buy-label">' + esc(label) + '</div>'
      + '<div class="pay-value"><code class="mono' + (big ? ' big' : '') + '">' + esc(value) + '</code>'
      + '<button type="button" class="btn btn-secondary btn-copy" data-copy-text="' + esc(value) + '">' + esc(t('copy')) + '</button></div></div>';
  }
  function qrSvg(text) {
    try {
      if (typeof qrcode !== 'function') return '';
      var qr = qrcode(0, 'M'); qr.addData(text); qr.make();
      return '<div class="pay-qr" aria-hidden="true">' + qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) + '</div>';
    } catch (e) { return ''; }
  }

  function renderPay() {
    var o = state.order; if (!o) return;
    var p = o.pay || {}, m = o.method, html = '';
    payTitle.textContent = m === 'gram' ? t('payGram') : m === 'usdt' ? t('payUsdt') : t('payPaxum');

    if (o.status === 'paid') { renderDone(); showStep('done'); return; }

    if (o.status === 'expired') {
      html = '<p class="pay-warn">' + esc(t('expired')) + '</p>'
        + '<div class="buy-nav"><button type="button" class="btn btn-ghost" data-back="key">← ' + esc(TIER_NAME[o.tier] || '') + '</button>'
        + '<button type="button" class="btn btn-primary" id="pay-new">' + esc(t('newInvoice')) + '</button></div>';
      payBody.innerHTML = html; bindPay(); return;
    }
    if (o.status === 'rejected') {
      html = '<p class="pay-warn">' + esc(t('rejected')) + ' ' + esc(tReason(o.reasonCode) || o.reason || '') + '</p>'
        + '<p>' + esc(t('support')) + ' <a href="https://t.me/velourapp">t.me/velourapp</a> · <a href="mailto:sale@velourff.com">sale@velourff.com</a></p>'
        + '<div class="buy-nav"><button type="button" class="btn btn-primary" id="pay-new">' + esc(t('newInvoice')) + '</button></div>';
      payBody.innerHTML = html; bindPay(); return;
    }

    var fields = '', qr = '', wait = '', extra = '';
    if (m === 'gram') {
      qr = qrSvg(p.deeplink || p.address || '');
      fields += field(t('fAmount'), p.amount + ' ' + (p.currency || 'GRAM'), true);
      if (p.usd) fields += '<p class="buy-hint" style="margin:-6px 0 12px">' + esc(t('rateLine', { usd: p.usd })) + '</p>';
      fields += field(t('fAddress'), p.address || '');
      fields += field(t('fComment'), p.comment || '');
      fields += '<div class="pay-warn">' + esc(t('warnGram')) + '</div>';
      if (p.deeplink) fields += '<div class="buy-nav" style="justify-content:flex-start"><a class="btn btn-primary" href="' + esc(p.deeplink) + '">' + esc(t('openWallet')) + '</a></div>';
      wait = waitLine(o);
    } else if (m === 'usdt') {
      qr = qrSvg(p.address || '');
      fields += field(t('fAmount'), p.amount + ' ' + (p.currency || 'USDT'), true);
      if (p.usd) fields += '<p class="buy-hint" style="margin:-6px 0 12px">' + esc(t('usdLine', { usd: p.usd })) + ' · ' + esc(p.network || 'TRC-20') + '</p>';
      fields += field(t('fAddress'), p.address || '');
      fields += '<div class="pay-warn">' + esc(t('warnUsdt', { amount: p.amount })) + '</div>';
      if (o.status === 'pending') {
        extra = '<form id="tx-form" class="buy-form"><label class="buy-label" for="tx-input">' + esc(t('txLabel')) + '</label>'
          + '<div class="buy-row"><input id="tx-input" class="buy-input mono" type="text" spellcheck="false" autocapitalize="off" placeholder="64 hex" required>'
          + '<button type="submit" class="btn btn-primary">' + esc(t('txCheck')) + '</button></div>'
          + '<p class="buy-error" id="tx-error" role="alert"' + (o.reasonCode ? '' : ' hidden') + '>' + esc(tReason(o.reasonCode) || o.reason || '') + '</p></form>';
      }
      wait = waitLine(o);
    } else {
      fields += field(t('fAmount'), '$' + p.amount, true);
      fields += field(t('fRecipient'), p.email || '');
      fields += field(t('fReference'), p.reference || '');
      fields += '<div class="pay-warn">' + esc(t('warnPaxum')) + '</div>';
      if (o.status === 'pending') {
        extra = '<form id="claim-form" class="buy-form"><label class="buy-label" for="note-input">' + esc(t('noteLabel')) + '</label>'
          + '<div class="buy-row"><input id="note-input" class="buy-input" type="text" maxlength="200">'
          + '<button type="submit" class="btn btn-primary">' + esc(t('claimBtn')) + '</button></div>'
          + '<p class="buy-error" id="claim-error" role="alert" hidden></p></form>';
      }
      wait = waitLine(o);
    }
    html = (qr ? '<div class="pay-grid">' + qr + '<div>' + fields + '</div></div>' : fields) + extra + wait
      + '<p class="buy-hint">' + esc(t('closeOk')) + '</p>';
    payBody.innerHTML = html; bindPay(); tick();
  }
  function waitLine(o) {
    var txt = o.status === 'checking' ? t('waitingTx') : o.status === 'awaiting_review' ? t('waitingReview') : t('waiting');
    var timer = (o.status === 'pending' && o.expiresAt) ? ' <span class="pay-timer" id="pay-timer"></span>' : '';
    return '<div class="pay-wait"><span class="dot"></span><span>' + esc(txt) + timer + '</span></div>';
  }
  function tick() {
    clearInterval(tickTimer);
    var el = $('#pay-timer'); if (!el || !state.order || !state.order.expiresAt) return;
    var end = new Date(state.order.expiresAt).getTime();
    var upd = function () {
      var left = Math.max(0, end - Date.now());
      var h = Math.floor(left / 3600000), mi = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
      el.textContent = '· ' + t('timer', { t: (h ? h + ':' : '') + String(mi).padStart(2, '0') + ':' + String(s).padStart(2, '0') });
      if (left <= 0) { clearInterval(tickTimer); poll(); }
    };
    upd(); tickTimer = setInterval(upd, 1000);
  }
  function bindPay() {
    var nw = $('#pay-new'); if (nw) nw.addEventListener('click', function () { stopPoll(); state.order = null; renderMethod(); showStep('method'); });
    payBody.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { stopPoll(); showStep(b.getAttribute('data-back')); }); });
    var tx = $('#tx-form');
    if (tx) tx.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#tx-input').value.trim().replace(/^0x/i, ''), err = $('#tx-error');
      if (!/^[0-9a-fA-F]{64}$/.test(v)) { err.textContent = t('txBad'); err.hidden = false; return; }
      var btn = tx.querySelector('button'); btn.disabled = true; err.hidden = true;
      api('/v1/orders/txid', { orderId: state.order.orderId, txid: v.toLowerCase() }).then(function (r) { state.order = r.order; renderPay(); })
        .catch(function (e2) { err.textContent = e2.code === 'bad_txid' ? t('txBad') : errText(e2); err.hidden = false; btn.disabled = false; });
    });
    var cl = $('#claim-form');
    if (cl) cl.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = ($('#note-input').value || '').trim().slice(0, 200), err = $('#claim-error');
      var btn = cl.querySelector('button'); btn.disabled = true; err.hidden = true;
      api('/v1/orders/claim', note ? { orderId: state.order.orderId, note: note } : { orderId: state.order.orderId })
        .then(function (r) { state.order = r.order; renderPay(); })
        .catch(function (e2) { err.textContent = errText(e2); err.hidden = false; btn.disabled = false; });
    });
  }

  // ── Опрос состояния ───────────────────────────────────────────────────────────────────
  function startPoll() { stopPoll(); pollTimer = setInterval(poll, POLL_MS); }
  function stopPoll() { clearInterval(pollTimer); pollTimer = null; clearInterval(tickTimer); }
  function poll() {
    if (!state.order || !OPEN[state.order.status]) { stopPoll(); return; }
    api('/v1/orders/status', { orderId: state.order.orderId }).then(function (r) {
      var o = r.order; if (!o) return;
      var changed = o.status !== state.order.status || o.reasonCode !== state.order.reasonCode;
      state.order = o;
      if (changed) renderPay();
      if (!OPEN[o.status]) stopPoll();
    }).catch(function () { /* временный сбой сети — следующий опрос покажет */ });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.order && OPEN[state.order.status]) poll(); });

  // ── Готово ────────────────────────────────────────────────────────────────────────────
  function renderDone() {
    var o = state.order, r = (o && o.result) || {};
    var tier = TIER_NAME[r.tier || o.tier] || '';
    $('#done-title').textContent = t('doneTitle', { tier: tier });
    $('#done-text').textContent = r.queued ? t('doneQueued', { date: fmtDate(r.periodEnd), n: r.prepaid || 1 }) : t('doneNow', { date: fmtDate(r.periodEnd) });
    $('#done-key').textContent = state.key;
  }

  // ── Копирование ───────────────────────────────────────────────────────────────────────
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy-text],[data-copy]'); if (!b) return;
    var txt = b.hasAttribute('data-copy-text') ? b.getAttribute('data-copy-text') : ($(b.getAttribute('data-copy')) || {}).textContent || '';
    copyText(txt).then(function () {
      b.classList.add('is-copied'); setLabel(b, t('copied'));
      setTimeout(function () { b.classList.remove('is-copied'); restoreLabels(b); }, 1500);
    }).catch(function () {});
  });
  // Кнопки со статикой RU/EN внутри (data-lang-спаны) после динамической подмены текста надо вернуть как было.
  function setLabel(btn, txt) { if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML; btn.textContent = txt; }
  function restoreLabels(btn) { if (btn.dataset.orig) { btn.innerHTML = btn.dataset.orig; delete btn.dataset.orig; } }

  // ── Смена языка на лету: перерисовать динамические блоки ─────────────────────────────
  new MutationObserver(function () {
    renderKeyStatus();
    if (state.quota || state.expired) renderTier();
    if (state.order && state.step === 'pay') renderPay();
    if (state.step === 'done') renderDone();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ── Старт ─────────────────────────────────────────────────────────────────────────────
  showStep('key');
  keyInput.focus();
})();
