# Scholaris API

Express + MongoDB REST API for the Scholaris School Management System. The frontend lives in
[`../client`](../client).

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`: `MONGODB_URI`, a `JWT_SECRET` of 32+ characters, and Gmail SMTP details.
Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Scripts

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | API on http://localhost:5051, restarts on changes                |
| `npm start`             | Production start                                                 |
| `npm run seed`          | **Wipes** the database and loads a sample school                 |
| `npm run seed:demo`     | Creates or resets the three public demo logins                   |
| `npm run seed:logins`   | Gives existing students/teachers a login with a temporary password |
| `npm run set-password`  | Sets one account's password (`-- --email=… --password=…`)        |
| `npm run backup`        | Exports every collection to `backups/`                           |
| `npm run smoke:atlas`   | End-to-end tests on a separate `scholaris_smoke_test` database   |

## Demo login

`npm run seed:demo` creates these accounts (no email code needed):

| Panel   | Login page       | Email                      | Password          |
| ------- | ---------------- | -------------------------- | ----------------- |
| Admin   | `/admin/login`   | `demo.admin@example.com`   | `DemoAdmin2026`   |
| Teacher | `/teacher/login` | `demo.teacher@example.com` | `DemoTeacher2026` |
| Student | `/student/login` | `demo.student@example.com` | `DemoStudent2026` |

## Email

Sign-in codes, sign-in alerts, password resets and fee reminders go out through Gmail SMTP.
Use a Google **App Password** (needs 2-Step Verification), not the account password.
With `MAIL_PREVIEW_ONLY=true` emails are printed to the console instead and the code is shown
on screen — development only; the API refuses to start that way in production.

## Security

* Password + 6-digit email code on every sign-in (demo accounts excepted).
* Short-lived access cookie with a rotating refresh cookie; reuse of an old refresh token ends
  every session of that account.
* Lockout after repeated wrong passwords, rate limits on auth routes, audit log of sign-ins and changes.
* The role always comes from the database record, never from the request.
* Teachers can only work with the classes they are assigned to; students only see their own records.
* Demo accounts cannot delete, change passwords or settings, email anyone, or change account emails.

## Structure

```
src/
  index.js        start-up: check env, connect, verify SMTP, listen
  app.js          middleware, /health, /api, error handling
  seed.js         sample data for npm run seed
  config/         env, database, mailer
  models/         User, Session, AuditLog and the school models
  middleware/     auth, demo restrictions, validation, rate limits, errors
  controllers/    one file per area (auth, students, fees, …)
  routes/         every route with its guards and validators
  validators/     request validation rules
  utils/          errors, sessions, OTP, pagination, audit
scripts/          seeding, backups, smoke tests
```

All routes are under `/api`; `GET /health` reports database and mail status.
