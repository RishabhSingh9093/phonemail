# PhoneMail

Turn your phone number into an email address: `<phone>@phonemail.com`

Built for the **AlphaStack Buildathon**. Log in with SMS OTP, send mail via SMTP, view on web or Android, in English / हिन्दी / தமிழ்.

---

## 📱 Try the app

**Web app:** run locally with `docker compose up -d` then open http://localhost:5173

**Android APK:** [⬇️ Download the latest APK](https://expo.dev/accounts/rishabh_86/projects/phonemail/builds/34d32fdc-b4ab-4ec0-bf7a-ef47a0dda898)

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18 + Express |
| Database | PostgreSQL 15 |
| Auth | JWT (HS256) + SHA-256 hashed OTPs |
| SMS | Textbee gateway (dev OTP fallback) |
| Email (local) | Go microservice → Mailpit SMTP |
| Email (external) | Gmail SMTP (App Password) |
| Encryption at rest | AES-256-GCM (message bodies) |
| Web client | React 18 + Vite + Nginx |
| Mobile client | React Native (Expo SDK 51) + i18n-js |
| Infra | Docker Compose (5 services) |
| APK build | EAS Build (cloud) |

---

## Architecture

    ┌──────────────┐      ┌──────────────┐
    │  Web Client  │      │ Mobile (APK) │
    │  React+Vite  │      │ React Native │
    └──────┬───────┘      └──────┬───────┘
           │                     │
           └──────────┬──────────┘
                      │ HTTP + JWT
                      ▼
              ┌───────────────┐
              │    Backend    │
              │ Node+Express  │
              └────┬──────┬───┘
                   │      │
        ┌──────────┘      └────────────┐
        ▼                              ▼
 ┌─────────────┐             ┌──────────────┐
 │ PostgreSQL  │             │ mail-service │
 │  users      │             │   (Go)       │
 │  messages   │             └──────┬───────┘
 │  otp_codes  │                    │ SMTP
 │  attachments│                    ▼
 └─────────────┘             ┌──────────────┐
                             │   Mailpit    │
                             │ (local SMTP) │
                             └──────────────┘

---

## Approach

1. **Phone as identity** — deterministic `<digits>@phonemail.com` on signup
2. **OTP-first auth** — no passwords. OTPs hashed at rest, single-use, 10-min expiry, 5-attempt limit
3. **Two SMTP paths** — internal `@phonemail.com` messages route through a Go microservice → Mailpit; external recipients go through Gmail SMTP
4. **Encryption at rest** — every message body is AES-256-GCM encrypted before hitting Postgres
5. **Two clients, one API** — web and mobile share the same REST surface
6. **i18n with location hint** — English / Hindi / Tamil, with device-locale default and opt-in geolocation
7. **Docker-first** — `docker compose up -d` brings up everything

---

## How to set up

### Prerequisites
- Docker Desktop
- Node.js 18+ (only for local mobile development)

### 1. Clone the repo

    git clone https://github.com/RishabhSingh9093/phonemail.git
    cd phonemail

### 2. Create `.env`

Copy `.env.example` to `.env` and fill in real values:

    cp .env.example .env

    TEXTBEE_API_KEY=txb_xxx
    JWT_SECRET=change_me
    OTP_MODE=auto
    GMAIL_USER=you@gmail.com
    GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
    MESSAGE_KEY=<64-char hex>

- **`TEXTBEE_API_KEY`** — optional. If missing, backend falls back to on-screen dev OTP
- **`MESSAGE_KEY`** — generate with `openssl rand -hex 32`
- **`GMAIL_APP_PASSWORD`** — Gmail App Password (16 chars), requires 2FA

### 3. Start everything

    docker compose up -d

First run builds the Node/Go/React images — takes ~2 minutes.

### 4. Open the apps

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| Backend API | http://localhost:5001 |
| Mailpit (SMTP inbox) | http://localhost:8025 |
| PostgreSQL | localhost:5432 |

### 5. Test login

    Phone: 9695199093
    OTP:   shown on-screen (development mode) OR delivered by SMS (auto mode)

### 6. Mobile app

**Option A — Download the prebuilt APK (recommended):**

[⬇️ Download PhoneMail APK](https://expo.dev/accounts/rishabh_86/projects/phonemail/builds/34d32fdc-b4ab-4ec0-bf7a-ef47a0dda898)

Install it on an Android device. The APK is pre-configured to talk to a public
backend URL, so no additional setup is required.

**Option B — Build the APK locally (requires Android Studio + JDK 17):**

    cd mobile
    npm install
    npx expo prebuild -p android --clean
    cd android && ./gradlew assembleRelease

APK output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

**Option C — Run in Expo (development preview):**

    cd mobile
    npm install
    npx expo start --web       # browser preview
    npx expo start             # QR code → Expo Go app on phone

> **Note:** The `eas build` command is tied to the original author's Expo
> account and signing keystore. It will not work for external users.
> Use Option A, B, or C instead.

---

## API reference

### Auth
- `POST /auth/request-otp` — `{ phone }`
- `POST /auth/register` — `{ phone, otp }`
- `POST /auth/login` — `{ phone, otp }`

### Profile (Bearer token)
- `GET /me`
- `PATCH /me` — `{ name?, language? }`
- `GET /me/address`

### Mailbox (Bearer token)
- `GET /conversations?folder=inbox&q=search`
- `GET /conversations/:id/messages`
- `POST /messages` — `{ to, subject, body, attachmentIds? }`
- `POST /messages/:id/reply` — `{ body, attachmentIds? }`
- `PATCH /messages/:id/read`
- `PATCH /messages/:id/favorite`
- `PATCH /conversations/:id/folder` — `{ folder }`
- `DELETE /conversations/:id` — soft delete to trash
- `DELETE /conversations/:id/permanent`
- `PATCH /conversations/mark-all-read`

### Attachments
- `POST /attachments` — multipart `file`
- `GET /attachments/:id`

### Webhooks
- `POST /webhook/inbound` — inbound mail webhook
- `POST /development/incoming` — dev-only inbound seeder

---

## Development OTP

When `OTP_MODE=development` **or** no `TEXTBEE_API_KEY` is set, the OTP is returned in the API response and shown on the auth screen. No SMS is sent.

When `OTP_MODE=auto` and a valid Textbee key is configured, the OTP is delivered by SMS.

---

## Project layout

    .
    ├── backend/          Node.js + Express API
    ├── database/init/    Postgres schema (auto-runs on first start)
    ├── mail-service/     Go SMTP microservice
    ├── web/              React + Vite frontend (Nginx)
    ├── mobile/           React Native (Expo)
    ├── docker-compose.yml
    └── README.md

---

## Security notes

- Message bodies are AES-256-GCM encrypted at rest (`v1:` prefix in the DB)
- JWT signed with HS256; only hashes of OTPs are stored
- `/auth/*` endpoints are rate-limited (20 req / 15 min per IP)
- Helmet.js on all backend responses
- `.env` is gitignored; secrets are supplied via environment variables

---

## License

MIT — built for educational purposes.
