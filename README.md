# PhoneMail

Turn your phone number into an email address: `<phone>@phonemail.com`

Built for a college hackathon. Log in with SMS OTP, send mail via SMTP, view on web or Android, in English / हिन्दी / தமிழ்.

## Quick start (two commands)

    git clone <repo-url> phonemail
    cd phonemail && docker compose up -d

First run takes ~2 minutes to build images.

## URLs

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| Backend API | http://localhost:5001 |
| Mailpit (SMTP inbox) | http://localhost:8025 |
| PostgreSQL | localhost:5432 |

## Test login

    Phone: 9695199093
    OTP:   shown on-screen (development mode)

## What it does

- Phone-number authentication with SMS OTP via Textbee (hashed, single-use, 10-min expiry)
- JWT sessions (7-day signed tokens)
- PhoneMail address generated from phone number
- Mailbox: Inbox, Drafts, Spam, Trash + All/Unread/Favorites/Attachments filters
- Compose, reply, mark read, favorite
- Local SMTP: Go microservice sends through Mailpit (port 1025)
- External email via Gmail SMTP
- Multilingual: English, Hindi, Tamil, with location-based language suggestion
- Mobile APK built with React Native (Expo)

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18 + Express |
| Database | PostgreSQL 15 |
| Auth | JWT + SHA-256 OTP hashing |
| SMS | Textbee |
| SMTP | Go microservice + Mailpit + Gmail SMTP |
| Web | React + Vite + Nginx |
| Mobile | React Native + Expo + i18n-js |
| Orchestration | Docker Compose |
| APK build | EAS Build |

## Environment variables

Create `.env` at the project root (gitignored):

    TEXTBEE_API_KEY=tb_xxx
    JWT_SECRET=change_me
    OTP_MODE=auto
    GMAIL_USER=you@gmail.com
    GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx

`mobile/.env` for the APK build:

    EXPO_PUBLIC_API_URL=https://your-ngrok-url.ngrok-free.app

## API reference

### Auth
- `POST /auth/request-otp` — body `{phone}`
- `POST /auth/register` — body `{phone, otp}`
- `POST /auth/login` — body `{phone, otp}`

### Profile (Bearer token)
- `GET /me`
- `PATCH /me` — body `{name?, language?}`
- `GET /me/address`

### Mailbox (Bearer token)
- `GET /conversations?folder=inbox`
- `GET /conversations/:id/messages`
- `POST /messages` — body `{to, subject, body}`
- `POST /messages/:id/reply` — body `{body}`
- `PATCH /messages/:id/read`
- `PATCH /messages/:id/favorite`

### Development
- `POST /development/incoming` — inject a fake inbound message
- `GET /health`

## Development OTP

When `OTP_MODE=development` or no `TEXTBEE_API_KEY` is set, the OTP is returned in the API response and shown on the auth screen. No SMS is sent, no credits consumed.

When a valid Textbee key is set and `OTP_MODE=auto`, the OTP is delivered by SMS.

## Project layout

    .
    ├── backend/          Node.js + Express API
    ├── database/init/    Postgres schema (auto-runs on first start)
    ├── mail-service/     Go SMTP microservice
    ├── web/              React + Vite frontend (Nginx)
    ├── mobile/           React Native (Expo)
    ├── docker-compose.yml
    └── README.md

## Running the mobile app

Development (browser preview):

    cd mobile
    npm install
    npx expo start --web

Android APK (cloud build):

    cd mobile
    npm install
    eas build -p android --profile preview

## Testing

    docker compose ps                       # all 5 services healthy
    curl http://localhost:5001/health       # {"status":"ok"}

Then in the browser:
1. Register with a phone number + dev OTP
2. Compose a message to your own `@phonemail.com` address
3. Confirm it appears in Mailpit at http://localhost:8025

## Known limitations

- No end-to-end encryption
- Attachments not implemented
- Rate limiting on `/auth/*` not implemented
- External SMTP blocked on some networks (ISP-level); local SMTP works

## License

MIT — built for educational purposes.