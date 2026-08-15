import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';

interface SmtpEnv {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

function getSmtpEnv(): SmtpEnv | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !port || !user || !password || !from) return null;
  return { host, port: Number(port), user, password, from };
}

export function isEmailConfigured(): boolean {
  return getSmtpEnv() !== null;
}

export function buildSigningLinkMailOptions(
  recipientEmail: string,
  recipientName: string,
  documentTitle: string,
  signingLink: string,
  from: string
): SendMailOptions {
  return {
    from,
    to: recipientEmail,
    subject: `Please sign: ${documentTitle}`,
    text: `Hi ${recipientName},\n\nPlease review and sign "${documentTitle}" using the link below:\n${signingLink}\n`,
    html: `<p>Hi ${recipientName},</p><p>Please review and sign "${documentTitle}" using the link below:</p><p><a href="${signingLink}">${signingLink}</a></p>`,
  };
}

let transporter: Transporter | null = null;

function getTransporter(env: SmtpEnv): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.host,
      port: env.port,
      auth: { user: env.user, pass: env.password },
    });
  }
  return transporter;
}

export async function sendSigningLinkEmail(
  recipientEmail: string,
  recipientName: string,
  documentTitle: string,
  signingLink: string
): Promise<void> {
  const env = getSmtpEnv();
  if (!env) {
    throw new Error('SMTP is not configured');
  }
  const mailOptions = buildSigningLinkMailOptions(
    recipientEmail,
    recipientName,
    documentTitle,
    signingLink,
    env.from
  );
  await getTransporter(env).sendMail(mailOptions);
}
