# SeoDental — Dijital Diş Protez Laboratuvarı (one-page website)

A single-page corporate website in plain HTML5, CSS3 and vanilla JavaScript (no frameworks, no build
step) plus a small Node.js backend for **real user registration, login, logout and accounts**
(Stage 1 — see "Backend: accounts" below). The contact form and everything else is still front-end only.

## Structure

```
dental-website/
├── index.html                 All markup: header, 8 sections, footer, 2 dialogs, inline SVG icon sprite
├── css/style.css              All styling (variables, header, hero, sections, forms, dialogs, responsive, a11y)
├── js/main.js                 All behaviour (menu, smooth scroll, scroll-spy, dialogs, FAQ, forms)
├── assets/
│   ├── images/                seodental-logo.png, tooth-emblem.png, favicon.png
│   │   └── products/          6 original SVG illustrations for the product cards
│   ├── icons/                 (empty) icons live in the inline sprite at the top of index.html
│   └── fonts/                 Self-hosted Plus Jakarta Sans + Inter (woff2) and their OFL licences
└── README.md
```

## Run locally

Registration and login need the backend, which also serves the site (same origin, so the secure
cookie works). Node.js 22.13 or newer is required; there is nothing to `npm install`.

```bash
cd dental-website
cp .env.example .env          # then edit (see "Backend: accounts")
npm run migrate               # creates data/seodental.sqlite
npm start                     # http://127.0.0.1:3000
npm test                      # 23 automated tests
```

For local testing over plain http set `NODE_ENV=development` and `COOKIE_SECURE=false` in `.env`.
Opening `index.html` as a file, or `python3 -m http.server`, still shows the site, but sign-in then
cannot work because there is no backend.

## Page sections (all on the same page)

| Order | Section | id | Nav item highlighted |
|---|---|---|---|
| 1 | Hero | `ana-sayfa` | Ana Sayfa |
| 2 | Kurumsal (about, mission/vision, values) | `kurumsal` | Kurumsal |
| 3 | Neden Biz? | `neden-biz` | Kurumsal |
| 4 | Ürünlerimiz (6 cards + detail dialogs) | `urunlerimiz` | Ürünlerimiz |
| 5 | Teknoloji (6 capabilities + workflow diagram) | `teknoloji` | Teknoloji |
| 6 | İş Akışı (5-step timeline) | `is-akisi` | Teknoloji |
| 7 | Sıkça Sorulan Sorular (accordion) | `sss` | İletişim |
| 8 | İletişim (info + contact/quote form) | `iletisim` | İletişim |
| – | Footer (links, back-to-top) | – | – |

The header is sticky (the thin top bar scrolls away, the navbar stays). Scrolling uses
`scroll-padding-top`, which `js/main.js` keeps equal to the real navbar height, so headings are never
hidden behind it. `prefers-reduced-motion` switches smooth scrolling off.

## What works entirely in the browser

- Desktop navigation, mobile menu (open/close, Escape, tap outside), smooth scrolling, active-section highlight.
- Hero buttons, section "Teklif Alın" buttons, footer links, back-to-top.
- Product detail dialogs (opened from each card, closed with ✕, "Kapat", backdrop or Escape) and a
  "Bu kategori için teklif alın" button that pre-selects the category in the quote form.
- FAQ accordion (click, Enter/Space, arrow keys).
- Online Sipariş Girişi dialog: open/close, Escape, focus trap, show/hide password, validation.
- Contact/quote form: required-field, e-mail, phone and message-length validation with accessible
  messages (`aria-invalid`, `aria-describedby`, live status region).

## What needs a backend or external service

### 1. Contact / quote form delivery
The contact form has no backend yet (planned for a later stage). Until an endpoint is configured, a valid form shows an honest notice
("mesajınız iletilmedi") and offers a button that opens the visitor's own e-mail app with the message
pre-filled (a real `mailto:` link). It never claims the message was sent.

To connect a real service, set the endpoint in `js/main.js`:

```js
var CONFIG = {
  contactEndpoint: 'https://your-form-service.example/endpoint',   // or '/api/contact'
  authEndpoint: ''
};
```

The form then sends `POST` with `Content-Type: application/json` and this body:

```json
{ "requestType": "Teklif talebi", "name": "", "clinic": "", "email": "", "phone": "",
  "category": "zirkonyum", "categoryLabel": "Zirkonyum Restorasyonlar", "subject": "", "message": "" }
```

A `2xx` answer shows the success message and resets the form; any other status or a network failure
shows an error message and keeps what the visitor typed. The loading state (disabled button, spinner,
`aria-busy`) is already implemented. If you use a third-party form service or a different domain, it
must allow cross-origin requests (CORS) from your site.

### 2. Online order login — now implemented (Stage 1)

See "Backend: accounts" below. The old `authEndpoint` setting no longer exists.

## Replacing placeholder details

All contact details are visible placeholders in square brackets. Replace them in `index.html`:

| Detail | Where (search for) |
|---|---|
| Working hours | `[Pzt – Cmt 09:00 – 18:00]` (top bar, contact section, footer) |
| E-mail | `info@[alanadiniz].com` **and** the `mailto:info@example.com` links (3 places, all marked `data-contact-email`; the e-mail fallback reads the address from there) |
| Phone | `[+90 900 000 00 00]` **and** `tel:+900000000000` (3 places) |
| Address | `[Mahalle, Cadde, No – İlçe / Şehir]` (contact section, footer) |

## Content notes

The site text is deliberately general. It contains no company history, certificates, staff
qualifications, prices, guarantees, performance figures or claims about specific machines or
equipment. Product, technology and workflow sections describe general service categories and typical
digital workflows. **Have the owner review and, where appropriate, extend this wording** once verified
company information (equipment, delivery times, accepted file formats, shipping method, working
procedures) is available. FAQ answers that depend on company policy say so explicitly.

## Changing things

| What | Where |
|---|---|
| Colours, fonts, spacing, container width | `:root` variables at the top of `css/style.css` |
| Logo | Replace `assets/images/seodental-logo.png` (update `width`/`height` attributes to match) |
| Hero visual | Replace `assets/images/tooth-emblem.png` (transparent PNG) |
| Navigation links | `.nav__list` in `index.html` (a link needs a matching section `id`) |
| Add or edit a product | Copy one `<article class="product-card">` block; its `<template data-product-detail>` holds the dialog text. Add a matching `<option>` to the form's category select and a footer link |
| FAQ entries | Copy one `.accordion__item`; keep unique ids and matching `aria-controls` / `aria-labelledby` |
| Mobile-menu breakpoint | `62rem` in `css/style.css`; `62.0625rem` in `initMobileMenu()` of `js/main.js` must match |

## Assets and licences

- Logo and tooth emblem: cut from the logo image supplied by the project owner.
- Product illustrations (`assets/images/products/*.svg`): original drawings made for this project.
  They are schematic illustrations, not photographs of real work.
- Fonts: Plus Jakarta Sans and Inter, SIL Open Font License 1.1 (Fontsource packages); licence texts in `assets/fonts/`.
- Icons: simple hand-written line icons in the inline sprite; no external source.

## Accessibility

Skip link; visible focus outlines; native `<dialog>` for modals (focus trap, Escape, inert background,
focus returns to the opener); `aria-expanded`/`aria-controls` on the menu and FAQ; `aria-current` on the
active link; labelled form fields with error text (not colour alone); icon-only login button keeps its text
for screen readers; `prefers-reduced-motion` respected.


---

# Backend: accounts (Stage 1)

## Why this stack

The site is plain static HTML/JS, so the backend only has to add an API and serve the same files.
**Node.js with zero third-party packages** was chosen: no PHP/MySQL stack to administer, nothing to
install or keep patched through npm, one process that serves both site and API on one origin.
Node's own `crypto.scrypt` hashes passwords, and its built-in **SQLite** is the database.

SQLite is a real relational, ACID, persistent database (a single file, WAL mode). For one laboratory's
customer accounts on one server it is reliable and trivial to back up (copy `data/seodental.sqlite`).
The trade-off: it is one server, one file. If you later need several servers or a managed database,
all SQL lives in `server/` (`db.js`, `routes/auth.js`, `lib/*.js`) and `server/migrations/001_init.sql`
can be adapted to PostgreSQL. The Node SQLite module is marked "experimental" by Node (the API is stable
in practice, but check release notes when upgrading Node).

## Files

| Path | Purpose |
|---|---|
| `index.html` (modified) | Login dialog now has **Giriş Yap / Kayıt Ol** tabs, e-mail/phone registration, and a signed-in account view; header button becomes **Hesabım** |
| `css/style.css` (appended) | Section 12: account panel, badges, hints (reuses existing components) |
| `js/main.js` (modified) | Old fake-login code replaced by `initAccounts()` — calls `/api/*`; stores nothing in the browser |
| `server/index.js` | HTTP server: API routing, static files (allow-list only), security headers, CSP |
| `server/config.js` | Reads `.env`/environment variables |
| `server/db.js`, `server/migrate.js`, `server/migrations/001_init.sql` | Database access and schema (`users`, `sessions`, `verification_codes`, `rate_events`) |
| `server/routes/auth.js` | register, login, logout, session status, account, verify, resend |
| `server/lib/password.js` | scrypt hashing (N=32768, r=8, p=1, per-user salt, constant-time compare) |
| `server/lib/validation.js` | Server-side validation/normalisation; Turkish messages |
| `server/lib/sessions.js` | Server-side sessions; cookie holds a random token, DB holds only its SHA-256 |
| `server/lib/ratelimit.js` | Brute-force and abuse limits (stored in the database) |
| `server/lib/verification.js` | One-time 6-digit codes (stored as HMAC), expiry, attempt limit, resend cooldown |
| `server/lib/mailer.js`, `server/lib/sms.js` | Real SMTP client; Netgsm and Twilio SMS adapters |
| `test/` | Automated tests (`npm test`) |
| `.env.example`, `.gitignore`, `package.json` | Configuration template (placeholders only), ignore rules, scripts |

## Setup (production)

1. Install Node.js 22.13+ on the server.
2. Copy the project to the server. `cp .env.example .env`, set `NODE_ENV=production`, `APP_SECRET`
   (generate with the command in the file), `COOKIE_SECURE=true`, `PUBLIC_URL`.
3. `npm run migrate`, then run `npm start` under a process manager (systemd, pm2).
4. Put a reverse proxy with HTTPS (nginx/Caddy) in front, proxying everything to `127.0.0.1:3000`, and
   set `TRUST_PROXY=true`. Without HTTPS, browsers will not keep the Secure session cookie.
5. Make sure `.env` and `data/` are not readable by other users (`chmod 600 .env`). The built-in static
   handler only serves `index.html`, `css/`, `js/` and `assets/`; if you let nginx serve files directly,
   do not point it at the project root.
6. Back up `data/seodental.sqlite` regularly.

## Session policy

Server-side sessions, HttpOnly + SameSite=Lax + Secure cookie (`__Host-sid`). A new session token is issued
on every login (the previous one is destroyed). Signed out after 12 h idle or 14 days in total
(`SESSION_IDLE_HOURS`, `SESSION_MAX_DAYS`). Logout deletes the session in the database. State-changing
requests need JSON content type, a same-origin check, and (once signed in) an `X-CSRF-Token` header.

## Brute-force protection

Login: 5 failed attempts per account+IP, 20 per account, 50 per IP within 15 minutes, then HTTP 429
with `Retry-After`. Registration: 20 created accounts/hour and 60 attempts/hour per IP. Verification:
5 wrong guesses per code, 10 per 15 minutes per user, one code per minute, 5 per hour.

## Enabling e-mail verification

Needs an SMTP mailbox (your hosting provider's, or any transactional-mail SMTP service). In `.env`:

```
EMAIL_PROVIDER=smtp
SMTP_HOST=...   SMTP_PORT=587   SMTP_SECURE=false      # or 465 with SMTP_SECURE=true
SMTP_USER=...   SMTP_PASS=...   SMTP_FROM=SeoDental <noreply@yourdomain.com>
```

Restart. The server prints at start-up whether e-mail is configured. Set up SPF/DKIM for your domain so
the code mails do not land in spam. The client refuses to send credentials without TLS.

## Enabling SMS verification

Choose one provider in `.env` (`SMS_PROVIDER=netgsm` or `twilio`):

- **Netgsm** (Turkey): `NETGSM_USERCODE`, `NETGSM_PASSWORD`, and `NETGSM_MSGHEADER` (your approved sender title).
- **Twilio**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`).

## Verification behaviour (important)

- An account is created even if verification cannot be delivered; the response and the UI then say the code
  could **not** be sent, and the account shows **Doğrulanmadı**. No code is created or stored in that case.
- A contact is marked verified only after the correct code has been entered.
- Unverified users can currently sign in. When order features arrive you can require verification there.
- There is no password-reset flow yet (not part of this stage).

## Known limits of this stage

- E-mail and SMS delivery have only been exercised against local stand-in servers, not real providers.
- The "account exists" message on duplicate registration lets someone probe whether an e-mail/phone is registered
  (limited by rate limits); this was kept because clear duplicate errors were requested.
- No admin role UI exists. The `role` column defaults to `customer`; no admin account is created anywhere.
