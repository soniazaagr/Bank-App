import nodemailer from 'nodemailer'

const smtpHost = process.env.SMTP_HOST
const smtpPort = Number(process.env.SMTP_PORT)
const smtpUser = process.env.SMTP_USER
const smtpPassword = process.env.SMTP_PASSWORD
const smtpFrom = process.env.SMTP_FROM

function getTransporter() {
  if (
    !smtpHost ||
    !Number.isInteger(smtpPort) ||
    smtpPort <= 0 ||
    !smtpUser ||
    !smtpPassword ||
    !smtpFrom
  ) {
    throw new Error('SMTP configuration is incomplete')
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  })
}

export async function sendVerificationEmail(
  recipient: string,
  code: string,
) {
  await getTransporter().sendMail({
    from: `Nova Bank <${smtpFrom}>`,
    to: recipient,
    subject: 'Bank App email verification code',
    text: `Your Bank App verification code is ${code}. It expires in 10 minutes.`,
  })
}

export async function sendLoginVerificationEmail(
  recipient: string,
  code: string,
) {
  await getTransporter().sendMail({
    from: `Nova Bank <${smtpFrom}>`,
    to: recipient,
    subject: 'Nova Bank login verification code',
    text: `Your Nova Bank login verification code is ${code}. It expires in 10 minutes.`,
  })
}
