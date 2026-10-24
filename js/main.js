/**
 * SeoDental — front-end behaviour (vanilla JS, no dependencies)
 *
 *  1. Configuration (integration points for a backend)
 *  2. Helpers
 *  3. Header: measured offsets, sticky shadow, mobile menu
 *  4. One-page navigation: smooth scrolling, scroll-spy, back to top
 *  5. Dialogs: login + product details (native <dialog>)
 *  6. FAQ accordion
 *  7. Forms: validation, request type, submission (contact form)
 *  8. Accounts: register, login, logout, account panel (talks to /api/* on the Node backend)
 *
 * The browser never decides who is signed in: the server owns the session
 * (HttpOnly cookie). The UI only reflects what /api/auth/session reports.
 * The contact form still has no backend (a later stage) and says so honestly.
 */
(function () {
  'use strict';

  /* ======================================================================
     1. CONFIGURATION
     ====================================================================== */
  var CONFIG = {
    // POST endpoint that receives the contact / quote form as JSON.
    // Examples: a form service URL, or '/api/contact' on your own server.
    // Leave empty to keep the e-mail fallback.
    contactEndpoint: ''
  };

  var QUOTE_TYPE = 'Teklif talebi';
  var GENERAL_TYPE = 'Genel iletişim';
  var NAV_IDLE_MS = 140;           // scroll considered finished after this long without scroll events
  var NAV_FAILSAFE_MS = 1800;      // ...or after this long if the page was already at the target
  var HIGHLIGHT_MS = 2200;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // Loose browser-side phone check (10-15 digits); the server does the strict validation.
  var PHONE_PATTERN = /^\+?[\d\s()\-.]{10,20}$/;

  /* ======================================================================
     2. HELPERS
     ====================================================================== */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function scrollBehavior() { return reducedMotion.matches ? 'auto' : 'smooth'; }

  function throttleFrame(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () { queued = false; fn(); });
    };
  }

  /* ======================================================================
     3. HEADER
     ====================================================================== */
  var header = $('#site-header');
  var navbar = $('#navbar');
  var topbar = $('.topbar');
  var nav = $('#site-nav');
  var menuToggle = $('.nav-toggle');

  /** Publishes real header heights to CSS (sticky offset + scroll-padding). */
  function initHeaderMetrics() {
    if (!header || !navbar || !topbar) return;
    var root = document.documentElement;

    function update() {
      var topHeight = topbar.offsetHeight;
      root.style.setProperty('--topbar-live', topHeight + 'px');
      root.style.setProperty('--scroll-offset', navbar.offsetHeight + 'px');
      header.classList.toggle('is-stuck', window.scrollY > topHeight);
    }

    update();
    window.addEventListener('scroll', throttleFrame(update), { passive: true });
    window.addEventListener('resize', update);
    if ('ResizeObserver' in window) {
      var observer = new ResizeObserver(update);
      observer.observe(topbar);
      observer.observe(navbar);
    }
  }

  function isMenuOpen() { return Boolean(nav && nav.classList.contains('is-open')); }

  function setMenuOpen(open) {
    if (!nav || !menuToggle) return;
    nav.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
  }

  function initMobileMenu() {
    if (!nav || !menuToggle) return;
    var desktop = window.matchMedia('(min-width: 62.0625rem)'); // keep in sync with the 62rem breakpoint in style.css

    menuToggle.addEventListener('click', function () { setMenuOpen(!isMenuOpen()); });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isMenuOpen()) {
        setMenuOpen(false);
        menuToggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (isMenuOpen() && !header.contains(event.target)) setMenuOpen(false);
    });

    desktop.addEventListener('change', function (event) {
      if (event.matches) setMenuOpen(false);
    });
  }

  /* ======================================================================
     4. ONE-PAGE NAVIGATION
     ====================================================================== */
  var navLinks = $$('.nav__link');
  var navigating = false;          // true while a click-initiated smooth scroll is running
  var navigationTimer = null;

  function setActiveNav(id) {
    navLinks.forEach(function (link) {
      var active = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  /** Scrolls to an element on this page. Home goes to the very top. */
  function goTo(target, options) {
    var settings = options || {};
    var isHome = target.id === 'ana-sayfa';

    if (isHome) {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } else {
      target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }

    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    if (settings.focus !== false) target.focus({ preventScroll: true });

    var spyId = target.getAttribute('data-spy') || (isHome ? 'ana-sayfa' : null);
    if (spyId) {
      setActiveNav(spyId);
      beginNavigation();
    }

    try { history.replaceState(null, '', '#' + target.id); } catch (error) { /* file:// or sandboxed: ignore */ }
  }

  /** While a click-initiated scroll runs, the spy must not flicker through the sections it passes. */
  function beginNavigation() {
    navigating = true;
    scheduleNavigationEnd(NAV_FAILSAFE_MS);
  }

  function scheduleNavigationEnd(delay) {
    window.clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(function () {
      navigating = false;
      updateScrollSpy();
    }, delay);
  }

  function goToSection(id, options) {
    var target = document.getElementById(id);
    if (target) goTo(target, options);
  }

  function highlight(element) {
    element.classList.add('is-highlighted');
    window.setTimeout(function () { element.classList.remove('is-highlighted'); }, HIGHLIGHT_MS);
  }

  function initSmoothScroll() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;

      var hash = link.getAttribute('href');
      var target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
      if (!target) return;

      event.preventDefault();
      setMenuOpen(false);

      if (link.hasAttribute('data-quote')) setRequestType(QUOTE_TYPE);
      goTo(target);
      if (target.classList.contains('product-card')) highlight(target);
    });
  }

  var spySections = [];

  function updateScrollSpy() {
    if (!spySections.length) return;
    if (navigating) {
      scheduleNavigationEnd(NAV_IDLE_MS); // still scrolling: wait for it to settle
      return;
    }

    var offset = navbar ? navbar.offsetHeight : 0;
    var line = offset + window.innerHeight * 0.25;
    var current = spySections[0].id;

    spySections.forEach(function (item) {
      if (item.element.getBoundingClientRect().top <= line) current = item.id;
    });

    var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) current = spySections[spySections.length - 1].id;

    setActiveNav(current);
  }

  function initScrollSpy() {
    spySections = $$('main > section').map(function (element) {
      return { element: element, id: element.getAttribute('data-spy') || 'ana-sayfa' };
    });
    window.addEventListener('scroll', throttleFrame(updateScrollSpy), { passive: true });
    updateScrollSpy();
  }

  function initBackToTop() {
    $$('[data-scroll-top]').forEach(function (button) {
      button.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
        setActiveNav('ana-sayfa');
        beginNavigation();
        var brand = $('.brand');
        if (brand) brand.focus({ preventScroll: true });
      });
    });
  }

  /* ======================================================================
     5. DIALOGS
     ====================================================================== */
  var productContext = { category: '' };

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    setMenuOpen(false);
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', ''); // very old browsers: non-modal fallback
    }
    document.documentElement.classList.add('has-dialog');
  }

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function initDialogs() {
    $$('dialog').forEach(function (dialog) {
      // Click on the backdrop (the dialog element itself) closes it.
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', function () {
        if (!$('dialog[open]')) document.documentElement.classList.remove('has-dialog');
      });
    });

    document.addEventListener('click', function (event) {
      var opener = event.target.closest('[data-dialog-open]');
      if (opener) {
        openDialog(document.getElementById(opener.getAttribute('data-dialog-open')));
        return;
      }
      var closer = event.target.closest('[data-dialog-close]');
      if (closer) closeDialog(closer.closest('dialog'));
    });
  }

  /** Product detail dialog: fills itself from the clicked card's <template>. */
  function initProductDialog() {
    var dialog = $('#product-dialog');
    if (!dialog) return;

    var title = $('#product-dialog-title');
    var image = $('#product-dialog-image');
    var body = $('#product-dialog-body');

    $$('[data-product-open]').forEach(function (button) {
      button.addEventListener('click', function () {
        var card = button.closest('.product-card');
        var template = $('template[data-product-detail]', card);
        var cardImage = $('img', card);

        title.textContent = $('.product-card__title', card).textContent;
        image.src = cardImage.getAttribute('src');
        image.alt = cardImage.getAttribute('alt');
        body.textContent = '';
        if (template) body.appendChild(template.content.cloneNode(true));
        productContext.category = card.getAttribute('data-product') || '';

        openDialog(dialog);
        dialog.scrollTop = 0;
      });
    });

    $('#product-dialog-quote').addEventListener('click', function () {
      closeDialog(dialog);
      startQuote(productContext.category);
    });
  }

  /* ======================================================================
     6. FAQ ACCORDION
     ====================================================================== */
  function setFaqOpen(trigger, open) {
    trigger.setAttribute('aria-expanded', String(open));
    trigger.closest('.accordion__item').classList.toggle('is-open', open);
  }

  function initFaq() {
    var triggers = $$('.accordion__trigger');

    triggers.forEach(function (trigger, index) {
      trigger.addEventListener('click', function () {
        setFaqOpen(trigger, trigger.getAttribute('aria-expanded') !== 'true');
      });

      // Arrow keys / Home / End move between questions.
      trigger.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowDown') next = triggers[(index + 1) % triggers.length];
        if (event.key === 'ArrowUp') next = triggers[(index - 1 + triggers.length) % triggers.length];
        if (event.key === 'Home') next = triggers[0];
        if (event.key === 'End') next = triggers[triggers.length - 1];
        if (next) {
          event.preventDefault();
          next.focus();
        }
      });
    });
  }

  /* ======================================================================
     7. FORMS
     ====================================================================== */

  /* ---------- validation ---------- */

  /** Returns an error message for a field, or '' when it is valid. */
  function getFieldError(field) {
    var data = field.dataset;
    var value = field.type === 'checkbox' ? '' : field.value.trim();

    if (field.required) {
      var empty = field.type === 'checkbox' ? !field.checked : value === '';
      if (empty) return data.msgRequired || 'Bu alan zorunludur.';
    }
    if (value === '') return '';

    var invalid = data.msgInvalid || 'Lütfen geçerli bir değer girin.';

    if (field.type === 'email' && !EMAIL_PATTERN.test(value)) return invalid;

    if (field.type === 'tel' && field.pattern) {
      var digits = value.replace(/\D/g, '').length;
      var matches = new RegExp('^(?:' + field.pattern + ')$').test(value);
      if (!matches || digits < 7) return invalid;
    }

    if (data.validate === 'identifier') {
      var isEmail = value.indexOf('@') !== -1;
      if (isEmail ? !EMAIL_PATTERN.test(value) : !PHONE_PATTERN.test(value)) return invalid;
    }
    if (data.validate === 'phone' && !PHONE_PATTERN.test(value)) return invalid;
    if (data.validate === 'match') {
      var other = document.getElementById(data.match);
      if (other && other.value !== field.value) return invalid;
    }
    if (data.validate === 'password' && (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(value) || !/\d/.test(value))) {
      return 'Şifre en az bir harf ve bir rakam içermelidir.';
    }
    if (data.validate === 'code' && !/^\d{6}$/.test(value)) return invalid;

    if (field.minLength > 0 && value.length < field.minLength) {
      return data.msgShort || 'Girdiğiniz değer çok kısa.';
    }
    return '';
  }

  function errorElementFor(field) {
    var id = (field.getAttribute('aria-describedby') || '').split(' ')[0];
    return id ? document.getElementById(id) : null;
  }

  function showFieldError(field, message) {
    var errorElement = errorElementFor(field);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.hidden = !message;
    }
    if (message) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
  }

  function validatableFields(form) {
    return $$('input, select, textarea', form).filter(function (field) {
      return field.type !== 'radio' && !field.disabled && !field.closest('[hidden]');
    });
  }

  /** Validates every visible field; returns the first invalid field (or null). */
  function validateForm(form) {
    var firstInvalid = null;
    validatableFields(form).forEach(function (field) {
      var message = getFieldError(field);
      showFieldError(field, message);
      if (message && !firstInvalid) firstInvalid = field;
    });
    return firstInvalid;
  }

  function clearFormFeedback(form, status) {
    $$('input, select, textarea', form).forEach(function (field) { showFieldError(field, ''); });
    clearStatus(status);
  }

  function attachLiveValidation(form) {
    form.addEventListener('focusout', function (event) {
      var field = event.target;
      if (!field.matches || !field.matches('input, select, textarea') || field.type === 'radio') return;
      if (field.disabled || field.closest('[hidden]')) return;
      // Do not nag while the visitor is still typing in an untouched field, or when leaving the dialog.
      if (field.value === '' && field.type !== 'checkbox' && !field.hasAttribute('aria-invalid') && !field.dataset.touched) return;
      field.dataset.touched = 'true';
      showFieldError(field, getFieldError(field));
    });

    function revalidateIfInvalid(event) {
      var field = event.target;
      if (field.hasAttribute && field.hasAttribute('aria-invalid')) showFieldError(field, getFieldError(field));
    }
    form.addEventListener('input', revalidateIfInvalid);
    form.addEventListener('change', revalidateIfInvalid);
  }

  /* ---------- status + loading ---------- */

  function setStatus(status, type, message, extraNode) {
    status.className = 'form-status form-status--' + type;
    status.textContent = message;
    if (extraNode) status.appendChild(extraNode);
    status.hidden = false;
  }

  function clearStatus(status) {
    status.hidden = true;
    status.textContent = '';
    status.className = 'form-status';
  }

  function setLoading(button, loading, loadingText) {
    var label = $('.btn__text', button);
    if (loading) {
      button.dataset.idleText = label.textContent;
      label.textContent = loadingText;
    } else if (button.dataset.idleText) {
      label.textContent = button.dataset.idleText;
    }
    button.classList.toggle('is-loading', loading);
    button.disabled = loading;
    button.setAttribute('aria-busy', String(loading));
  }

  function postJson(endpoint, payload) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Shared submit flow: validate → (no endpoint ? explain honestly : POST with loading state).
   * The caller provides what is specific to each form.
   */
  function bindSubmit(options) {
    var form = options.form;
    attachLiveValidation(form);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(options.status);

      var firstInvalid = validateForm(form);
      if (firstInvalid) {
        setStatus(options.status, 'error', 'Lütfen işaretli alanları kontrol edip tekrar deneyin.');
        firstInvalid.focus();
        return;
      }

      var payload = options.collect();

      if (!options.endpoint()) {
        options.withoutEndpoint(payload);
        return;
      }

      setLoading(options.button, true, options.loadingText);
      postJson(options.endpoint(), payload)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json().catch(function () { return {}; });
        })
        .then(function (data) { options.onSuccess(data); })
        .catch(function () { options.onError(); })
        .then(function () { setLoading(options.button, false); });
    });
  }

  /* ---------- contact / quote form ---------- */

  var contactForm = $('#contact-form');

  function currentRequestType() {
    var checked = contactForm ? $('input[name="requestType"]:checked', contactForm) : null;
    return checked ? checked.value : GENERAL_TYPE;
  }

  /** Shows the category select only for quote requests (and only validates it then). */
  function syncRequestType() {
    if (!contactForm) return;
    var isQuote = currentRequestType() === QUOTE_TYPE;
    var wrapper = $('[data-quote-only]', contactForm);
    var select = $('#c-category');

    wrapper.hidden = !isQuote;
    select.disabled = !isQuote;
    select.required = isQuote;
    if (!isQuote) {
      select.value = '';
      showFieldError(select, '');
    }
  }

  function setRequestType(value) {
    if (!contactForm) return;
    $$('input[name="requestType"]', contactForm).forEach(function (radio) {
      radio.checked = radio.value === value;
    });
    syncRequestType();
  }

  /** Opens the quote form (optionally pre-selecting a category) and moves there. */
  function startQuote(category) {
    if (!contactForm) return;
    setRequestType(QUOTE_TYPE);

    var select = $('#c-category');
    var subject = $('#c-subject');
    if (category && $('option[value="' + category + '"]', select)) {
      select.value = category;
      showFieldError(select, '');
      if (!subject.value.trim()) {
        subject.value = 'Teklif talebi: ' + $('option[value="' + category + '"]', select).textContent;
      }
    }

    goToSection('iletisim', { focus: false });
    window.setTimeout(function () { $('#c-name').focus({ preventScroll: true }); }, reducedMotion.matches ? 0 : 600);
  }

  function contactEmailAddress() {
    var link = $('[data-contact-email]');
    return link ? link.getAttribute('href').replace(/^mailto:/i, '') : '';
  }

  function buildMailtoLink(payload) {
    var lines = [
      'Ad Soyad: ' + payload.name,
      'Klinik / Firma: ' + (payload.clinic || '-'),
      'E-posta: ' + payload.email,
      'Telefon: ' + (payload.phone || '-'),
      'Talep türü: ' + payload.requestType
    ];
    if (payload.category) lines.push('Hizmet kategorisi: ' + payload.categoryLabel);
    lines.push('', payload.message);

    return 'mailto:' + contactEmailAddress() +
      '?subject=' + encodeURIComponent(payload.subject) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  function initContactForm() {
    if (!contactForm) return;
    var status = $('#contact-status');

    $$('input[name="requestType"]', contactForm).forEach(function (radio) {
      radio.addEventListener('change', syncRequestType);
    });
    syncRequestType();

    function collect() {
      var data = new FormData(contactForm);
      var select = $('#c-category');
      var category = select.disabled ? '' : select.value;
      return {
        requestType: currentRequestType(),
        name: String(data.get('name')).trim(),
        clinic: String(data.get('clinic')).trim(),
        email: String(data.get('email')).trim(),
        phone: String(data.get('phone')).trim(),
        category: category,
        categoryLabel: category ? select.options[select.selectedIndex].textContent : '',
        subject: String(data.get('subject')).trim(),
        message: String(data.get('message')).trim()
      };
    }

    bindSubmit({
      form: contactForm,
      status: status,
      button: $('#contact-submit'),
      loadingText: 'Gönderiliyor…',
      endpoint: function () { return CONFIG.contactEndpoint; },
      collect: collect,

      // No backend yet: say so plainly and offer a real alternative (the visitor's mail app).
      withoutEndpoint: function (payload) {
        var mailLink = document.createElement('a');
        mailLink.className = 'btn btn--dark btn--sm';
        mailLink.href = buildMailtoLink(payload);
        mailLink.textContent = 'E-posta uygulamasında aç';

        setStatus(
          status,
          'info',
          'Formunuz doğru doldurulmuş, ancak bu sitede henüz bir form gönderim servisi bağlı olmadığı için mesajınız iletilmedi. ' +
          'Mesajı kendi e-posta uygulamanızdan göndermek için aşağıdaki düğmeyi kullanabilirsiniz.',
          mailLink
        );
        status.focus();
      },

      onSuccess: function () {
        contactForm.reset();
        $$('input, select, textarea', contactForm).forEach(function (field) { delete field.dataset.touched; });
        syncRequestType();
        setStatus(status, 'success', 'Mesajınız gönderildi. Teşekkür ederiz; en kısa sürede sizinle iletişime geçilecektir.');
        status.focus();
      },

      onError: function () {
        setStatus(status, 'error', 'Mesajınız gönderilemedi. Lütfen bağlantınızı kontrol edip tekrar deneyin veya e-posta ya da telefonla bize ulaşın.');
        status.focus();
      }
    });
  }

  /* ---------- accounts: password toggle, API client, views ---------- */

  function initPasswordToggle() {
    $$('[data-toggle-password]').forEach(function (button) {
      var input = document.getElementById(button.getAttribute('data-toggle-password'));
      button.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(show));
        button.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
        input.focus();
      });
    });
  }

  var auth = { user: null, csrf: '' };   // mirror of what the SERVER says; never trusted for access control

  /** JSON call to the backend. Resolves { ok, status, data } (data may be {}); rejects only on network failure. */
  function api(method, path, body) {
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && auth.csrf) headers['X-CSRF-Token'] = auth.csrf;
    return fetch(path, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function errorMessage(result, fallback) {
    return (result.data && result.data.error && result.data.error.message) || fallback;
  }

  var NETWORK_ERROR = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.';

  /** Maps server-side field errors ({ fields: { fullName: '...' } }) onto form inputs. Returns the first field shown. */
  function showServerFieldErrors(result, map) {
    var fields = result.data && result.data.error && result.data.error.fields;
    var first = null;
    if (!fields) return null;
    Object.keys(fields).forEach(function (name) {
      var input = map[name] && document.getElementById(map[name]);
      if (!input) return;
      showFieldError(input, fields[name]);
      if (!first) first = input;
    });
    return first;
  }

  function initAccounts() {
    var dialog = $('#login-dialog');
    if (!dialog) return;

    var els = {
      title: $('#login-title'), lead: $('#auth-lead'),
      guestView: $('[data-auth-view="guest"]', dialog), accountView: $('[data-auth-view="account"]', dialog),
      tabs: $$('input[name="authTab"]', dialog),
      loginForm: $('#login-form'), registerForm: $('#register-form'),
      loginStatus: $('#login-status'), registerStatus: $('#register-status'),
      verifyForm: $('#verify-form'), verifyStatus: $('#verify-status'), accountStatus: $('#account-status'),
      button: $('#auth-button'), buttonLabel: $('#auth-button-label')
    };
    var LEAD_GUEST = 'Sipariş paneline erişmek için giriş yapın veya yeni bir hesap oluşturun.';
    var registerFields = { fullName: 'r-name', identifier: 'r-ident', password: 'r-pass', passwordConfirm: 'r-pass2' };

    attachLiveValidation(els.loginForm);
    attachLiveValidation(els.registerForm);
    attachLiveValidation(els.verifyForm);

    /* ----- which view is shown ----- */

    function showTab(name) {
      var register = name === 'register';
      els.tabs.forEach(function (radio) { radio.checked = radio.value === name; });
      els.loginForm.hidden = register;
      els.registerForm.hidden = !register;
      clearStatus(els.loginStatus);
      clearStatus(els.registerStatus);
    }

    function render() {
      var user = auth.user;
      els.guestView.hidden = Boolean(user);
      els.accountView.hidden = !user;
      els.buttonLabel.textContent = user ? 'Hesabım' : 'Online Sipariş Girişi';
      if (user) {
        els.button.setAttribute('aria-label', 'Hesabım: ' + user.fullName);
        els.button.title = user.fullName;
        els.title.textContent = 'Hesabım';
        els.lead.textContent = 'Merhaba, ' + user.fullName + '.';
        renderAccount(user);
      } else {
        els.button.removeAttribute('aria-label');
        els.button.removeAttribute('title');
        els.title.textContent = 'Online Sipariş Girişi';
        els.lead.textContent = LEAD_GUEST;
      }
    }

    function setBadge(element, verified) {
      element.textContent = verified ? 'Doğrulandı' : 'Doğrulanmadı';
      element.className = 'badge ' + (verified ? 'badge--ok' : 'badge--pending');
    }

    // All user data is written with textContent (never innerHTML), so it cannot inject markup.
    function renderAccount(user) {
      $('#acc-name').textContent = user.fullName;
      $('#acc-email-row').hidden = !user.email;
      $('#acc-phone-row').hidden = !user.phone;
      if (user.email) { $('#acc-email').textContent = user.email; setBadge($('#acc-email-badge'), user.emailVerified); }
      if (user.phone) { $('#acc-phone').textContent = user.phone; setBadge($('#acc-phone-badge'), user.phoneVerified); }

      var verified = user.email ? user.emailVerified : user.phoneVerified;
      els.verifyForm.hidden = verified;
      if (!verified) {
        $('#verify-text').textContent = user.email
          ? 'E-posta adresiniz henüz doğrulanmadı. Adresinize gönderilen 6 haneli kodu girin.'
          : 'Telefon numaranız henüz doğrulanmadı. Numaranıza SMS ile gönderilen 6 haneli kodu girin.';
      }
    }

    function setSession(user, csrf) {
      auth.user = user || null;
      auth.csrf = user ? (csrf || auth.csrf) : '';
      render();
    }

    /** Server says we are signed out (expired/invalid session): reflect that. */
    function handleSignedOut() {
      setSession(null);
      showTab('login');
    }

    /* ----- opening the dialog ----- */

    els.button.addEventListener('click', function () {
      if (auth.user) {
        // Refresh from the server so the panel never shows stale data.
        api('GET', '/api/account').then(function (r) {
          if (r.status === 401) return handleSignedOut();
          if (r.ok) setSession(r.data.user);
        }).catch(function () { /* keep what is shown */ });
      } else {
        showTab('login');
      }
    });

    els.tabs.forEach(function (radio) {
      radio.addEventListener('change', function () { showTab(radio.value); });
    });

    /* ----- registration: e-mail / phone method ----- */

    var identInput = $('#r-ident');
    function syncRegisterMethod() {
      var phone = $('input[name="method"]:checked', els.registerForm).value === 'phone';
      $('#r-ident-label').textContent = phone ? 'Telefon numarası' : 'E-posta adresi';
      identInput.type = phone ? 'tel' : 'email';
      identInput.inputMode = phone ? 'tel' : 'email';
      identInput.autocomplete = phone ? 'tel' : 'email';
      identInput.placeholder = phone ? '05XX XXX XX XX' : '';
      identInput.dataset.validate = phone ? 'phone' : '';
      identInput.dataset.msgRequired = phone ? 'Lütfen telefon numaranızı yazın.' : 'Lütfen e-posta adresinizi yazın.';
      identInput.dataset.msgInvalid = phone ? 'Lütfen geçerli bir cep telefonu numarası girin (örn. 0532 123 45 67).' : 'Lütfen geçerli bir e-posta adresi girin.';
      identInput.value = '';
      showFieldError(identInput, '');
      delete identInput.dataset.touched;
    }
    $$('input[name="method"]', els.registerForm).forEach(function (r) { r.addEventListener('change', syncRegisterMethod); });

    // Typing the password again after changing the first one re-checks the match.
    $('#r-pass').addEventListener('input', function () {
      var confirm = $('#r-pass2');
      if (confirm.value !== '' || confirm.hasAttribute('aria-invalid')) showFieldError(confirm, getFieldError(confirm));
    });

    /* ----- submit: register ----- */

    els.registerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(els.registerStatus);
      var firstInvalid = validateForm(els.registerForm);
      if (firstInvalid) {
        setStatus(els.registerStatus, 'error', 'Lütfen işaretli alanları kontrol edip tekrar deneyin.');
        firstInvalid.focus();
        return;
      }
      var button = $('#register-submit');
      setLoading(button, true, 'Kaydediliyor…');
      api('POST', '/api/auth/register', {
        method: $('input[name="method"]:checked', els.registerForm).value,
        fullName: $('#r-name').value.trim(),
        identifier: identInput.value.trim(),
        password: $('#r-pass').value,
        passwordConfirm: $('#r-pass2').value
      }).then(function (r) {
        if (r.ok) {
          setSession(r.data.user, r.data.csrfToken);
          els.registerForm.reset();
          syncRegisterMethod();
          var v = r.data.verification || {};
          setStatus(els.accountStatus, v.status === 'sent' ? 'success' : 'info', 'Kaydınız tamamlandı. ' + (v.message || ''));
          els.accountStatus.focus();
          return;
        }
        var first = showServerFieldErrors(r, registerFields);
        setStatus(els.registerStatus, 'error', errorMessage(r, 'Kayıt tamamlanamadı. Lütfen tekrar deneyin.'));
        if (first) first.focus(); else els.registerStatus.focus();
      }).catch(function () {
        setStatus(els.registerStatus, 'error', NETWORK_ERROR);
        els.registerStatus.focus();
      }).then(function () { setLoading(button, false); });
    });

    /* ----- submit: login ----- */

    els.loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(els.loginStatus);
      var firstInvalid = validateForm(els.loginForm);
      if (firstInvalid) {
        setStatus(els.loginStatus, 'error', 'Lütfen işaretli alanları kontrol edip tekrar deneyin.');
        firstInvalid.focus();
        return;
      }
      var button = $('#login-submit');
      setLoading(button, true, 'Giriş yapılıyor…');
      api('POST', '/api/auth/login', { identifier: $('#l-user').value.trim(), password: $('#l-pass').value })
        .then(function (r) {
          if (r.ok) {
            clearAccountStatus();
            els.loginForm.reset();
            setSession(r.data.user, r.data.csrfToken);
            closeDialog(dialog);                          // signed in: the header button now reads "Hesabım"
            return;
          }
          setStatus(els.loginStatus, 'error', errorMessage(r, 'Giriş yapılamadı. Lütfen tekrar deneyin.'));
          els.loginStatus.focus();
        })
        .catch(function () {
          setStatus(els.loginStatus, 'error', NETWORK_ERROR);
          els.loginStatus.focus();
        })
        .then(function () { setLoading(button, false); });
    });

    function clearAccountStatus() { clearStatus(els.accountStatus); }

    /* ----- submit: verification code, resend, logout ----- */

    els.verifyForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(els.verifyStatus);
      var firstInvalid = validateForm(els.verifyForm);
      if (firstInvalid) { firstInvalid.focus(); return; }
      var button = $('#verify-submit');
      setLoading(button, true, 'Doğrulanıyor…');
      api('POST', '/api/account/verify', { code: $('#v-code').value.trim() })
        .then(function (r) {
          if (r.status === 401) return handleSignedOut();
          if (r.ok) {
            $('#v-code').value = '';
            setSession(r.data.user);
            setStatus(els.accountStatus, 'success', r.data.message || 'Doğrulama başarılı.');
            return;
          }
          showServerFieldErrors(r, { code: 'v-code' });
          setStatus(els.verifyStatus, 'error', errorMessage(r, 'Doğrulama yapılamadı.'));
        })
        .catch(function () { setStatus(els.verifyStatus, 'error', NETWORK_ERROR); })
        .then(function () { setLoading(button, false); });
    });

    $('#verify-resend').addEventListener('click', function () {
      clearStatus(els.verifyStatus);
      var button = this;
      button.disabled = true;
      api('POST', '/api/account/verify/resend')
        .then(function (r) {
          if (r.status === 401) return handleSignedOut();
          var info = (r.data && r.data.verification) || {};
          var message = info.message || errorMessage(r, 'Kod gönderilemedi.');
          setStatus(els.verifyStatus, info.status === 'sent' ? 'success' : 'error', message);
        })
        .catch(function () { setStatus(els.verifyStatus, 'error', NETWORK_ERROR); })
        .then(function () { button.disabled = false; });
    });

    $('#logout-button').addEventListener('click', function () {
      var button = this;
      setLoading(button, true, 'Çıkış yapılıyor…');
      api('POST', '/api/auth/logout')
        .then(function (r) {
          if (r.ok || r.status === 401) {
            handleSignedOut();
            closeDialog(dialog);
            return;
          }
          setStatus(els.accountStatus, 'error', errorMessage(r, 'Çıkış yapılamadı. Lütfen tekrar deneyin.'));
        })
        .catch(function () { setStatus(els.accountStatus, 'error', NETWORK_ERROR); })
        .then(function () { setLoading(button, false); });
    });

    /* ----- tidy up when the dialog closes ----- */

    dialog.addEventListener('close', function () {
      [els.loginForm, els.registerForm, els.verifyForm].forEach(function (form) {
        form.reset();
        $$('input', form).forEach(function (field) { delete field.dataset.touched; });
      });
      clearFormFeedback(els.loginForm, els.loginStatus);
      clearFormFeedback(els.registerForm, els.registerStatus);
      clearFormFeedback(els.verifyForm, els.verifyStatus);
      clearAccountStatus();
      syncRegisterMethod();
      $$('[data-toggle-password]', dialog).forEach(function (toggle) {
        document.getElementById(toggle.getAttribute('data-toggle-password')).type = 'password';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.setAttribute('aria-label', 'Şifreyi göster');
      });
      showTab('login');
    });

    $('[data-dialog-contact]', dialog).addEventListener('click', function () {
      closeDialog(dialog);
      setRequestType(GENERAL_TYPE);
      goToSection('iletisim');
    });

    /* ----- initial state: ask the SERVER whether the cookie is a valid session ----- */

    syncRegisterMethod();
    api('GET', '/api/auth/session').then(function (r) {
      if (r.ok && r.data.authenticated) setSession(r.data.user, r.data.csrfToken);
    }).catch(function () { /* backend not reachable (e.g. opened as a plain file): stay signed out */ });
  }

  /* ======================================================================
     INIT
     ====================================================================== */
  function initFooterYear() {
    $$('[data-year]').forEach(function (element) { element.textContent = String(new Date().getFullYear()); });
  }

  initHeaderMetrics();
  initMobileMenu();
  initSmoothScroll();
  initScrollSpy();
  initBackToTop();
  initDialogs();
  initProductDialog();
  initFaq();
  initPasswordToggle();
  initContactForm();
  initAccounts();
  initFooterYear();
})();
