import nodemailer from 'nodemailer'
import { env } from './env.js'
import { inBackground } from '../utils/background.js'

let transporter = null

// Gmail SMTP transport
function getTransporter() {
  if (transporter) return transporter

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: env.smtp.user,
      pass: env.smtp.appPassword,
    },
  })

  return transporter
}

export async function verifyMailer() {
  if (env.smtp.previewOnly) {
    console.log('[mail] preview mode — OTP emails are printed to the console, not sent')
    return { ok: true, preview: true }
  }
  try {
    await getTransporter().verify()
    console.log(`[mail] SMTP ready → ${env.smtp.host}:${env.smtp.port} as ${env.smtp.user}`)
    return { ok: true, preview: false }
  } catch (err) {
    console.error(`[mail] SMTP verification failed: ${err.message}`)
    console.error('       Check SMTP_USER / SMTP_APP_PASSWORD, or set MAIL_PREVIEW_ONLY=true.')
    return { ok: false, preview: false, error: err.message }
  }
}

async function send({ to, subject, text, html }) {
  if (env.smtp.previewOnly) {
    console.log('\n──────────── EMAIL PREVIEW ────────────')
    console.log(`To:      ${to}`)
    console.log(`Subject: ${subject}`)
    console.log(text)
    console.log('───────────────────────────────────────\n')
    return { preview: true }
  }

  const info = await getTransporter().sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.fromAddress}>`,
    to,
    subject,
    text,
    html,
  })
  return { preview: false, messageId: info.messageId }
}

function otpTemplate({ name, code, minutes }) {
  const spaced = code.split('').join(' ')
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#F8FAFC;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:440px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:20px;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0F766E;">Scholaris</p>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#0F172A;">Verify your sign-in</h1>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">
              Hi ${name || 'there'}, use the code below to finish signing in to your Scholaris account.
            </p>
            <div style="margin:0 0 24px;padding:20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;text-align:center;">
              <span style="font-size:30px;font-weight:700;letter-spacing:8px;color:#0F172A;">${spaced}</span>
            </div>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#475569;">
              This code expires in <strong style="color:#0F172A;">${minutes} minutes</strong> and can only be used once.
            </p>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">
              If you did not try to sign in, you can safely ignore this email — but please change your password.
            </p>
            <hr style="margin:24px 0 0;border:none;border-top:1px solid #E2E8F0;" />
            <p style="margin:16px 0 0;font-size:12px;color:#94A3B8;">
              This is an automated message from the Scholaris School Management System.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export async function sendOtpEmail({ to, name, code, minutes = env.otp.ttlMinutes }) {
  return send({
    to,
    subject: `${code} is your Scholaris verification code`,
    text: `Hi ${name || 'there'},\n\nYour Scholaris verification code is ${code}.\nIt expires in ${minutes} minutes and can only be used once.\n\nIf you did not try to sign in, please change your password.\n`,
    html: otpTemplate({ name, code, minutes }),
  })
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Shared layout for plain notification emails
function layout({ heading, paragraphs, button }) {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(p)}</p>`)
    .join('')
  const cta = button
    ? `<p style="margin:8px 0 22px;"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:12px 22px;background:#0F766E;color:#FFFFFF;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#F8FAFC;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:20px;"><tr><td style="padding:32px;">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0F766E;">Scholaris</p>
<h1 style="margin:0 0 16px;font-size:21px;font-weight:600;color:#0F172A;">${escapeHtml(heading)}</h1>
${body}${cta}
<hr style="margin:20px 0 0;border:none;border-top:1px solid #E2E8F0;" />
<p style="margin:16px 0 0;font-size:12px;color:#94A3B8;">This is an automated message from the Scholaris School Management System.</p>
</td></tr></table></td></tr></table></body></html>`
}

function sendNotice({ to, subject, heading, paragraphs, button }) {
  const text = [...paragraphs, button ? `${button.label}: ${button.href}` : ''].filter(Boolean).join('\n\n')
  return send({ to, subject, text, html: layout({ heading, paragraphs, button }) })
}

// Fire-and-forget for notifications that must not block or fail the request
export function sendInBackground(promiseFactory, label) {
  inBackground(
    Promise.resolve()
      .then(promiseFactory)
      .catch((err) => console.error(`[mail] ${label} failed: ${err.message}`)),
  )
}

export function sendPasswordResetEmail({ to, name, link, minutes }) {
  return sendNotice({
    to,
    subject: 'Reset your Scholaris password',
    heading: 'Reset your password',
    paragraphs: [
      `Hi ${name || 'there'}, we received a request to reset the password for your Scholaris account.`,
      `This link works once and expires in ${minutes} minutes.`,
      'If you did not ask for this, ignore this email — your password stays the same.',
    ],
    button: { label: 'Choose a new password', href: link },
  })
}

export function sendPasswordChangedEmail({ to, name }) {
  return sendNotice({
    to,
    subject: 'Your Scholaris password was changed',
    heading: 'Your password was changed',
    paragraphs: [
      `Hi ${name || 'there'}, the password for your Scholaris account was just changed, and other devices were signed out.`,
      'If this was not you, reset your password immediately and contact the school office.',
    ],
  })
}

export function sendAccountLockedEmail({ to, name, minutes, resetLink }) {
  return sendNotice({
    to,
    subject: 'Your Scholaris account was temporarily locked',
    heading: 'Account temporarily locked',
    paragraphs: [
      `Hi ${name || 'there'}, there were too many unsuccessful sign-in attempts on your Scholaris account, so it is locked for ${minutes} minutes.`,
      'If these attempts were not you, reset your password now.',
    ],
    button: { label: 'Reset password', href: resetLink },
  })
}

// "Chrome on Windows" from a user-agent string; falls back to "Unknown device"
function describeDevice(userAgent = '') {
  const ua = String(userAgent)
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\/|Opera/.test(ua) && 'Opera') ||
    (/Chrome\//.test(ua) && 'Chrome') ||
    (/Firefox\//.test(ua) && 'Firefox') ||
    (/Safari\//.test(ua) && 'Safari') ||
    ''
  const os =
    (/Windows/.test(ua) && 'Windows') ||
    (/Android/.test(ua) && 'Android') ||
    (/iPhone|iPad|iPod/.test(ua) && 'iOS') ||
    (/Mac OS X/.test(ua) && 'macOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    ''
  if (browser && os) return `${browser} on ${os}`
  return browser || os || 'Unknown device'
}

export function sendLoginAlertEmail({ to, name, when = new Date(), ip, userAgent, resetLink }) {
  const time = when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  return sendNotice({
    to,
    subject: 'New sign-in to your Scholaris account',
    heading: 'New sign-in',
    paragraphs: [
      `Hi ${name || 'there'}, your Scholaris account was just signed in to.`,
      `Time: ${time}`,
      `Device: ${describeDevice(userAgent)}`,
      `IP address: ${ip || 'unknown'}`,
      'If this was you, no action is needed. If not, reset your password now and contact the school office.',
    ],
    button: { label: 'Reset password', href: resetLink },
  })
}

export async function sendFeeReminderEmail({ to, name, invoiceNo, amount, dueDate }) {
  const subject = `Fee reminder — invoice ${invoiceNo}`
  return send({
    to,
    subject,
    text: `Hi ${name},\n\nInvoice ${invoiceNo} for Rs ${amount} is due on ${dueDate}.\nPlease settle it to avoid the late-payment surcharge.\n\n— Scholaris Accounts`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Invoice <strong>${escapeHtml(invoiceNo)}</strong> for <strong>Rs ${escapeHtml(amount)}</strong> is due on <strong>${escapeHtml(dueDate)}</strong>.</p><p>Please settle it to avoid the late-payment surcharge.</p><p>— Scholaris Accounts</p>`,
  })
}
