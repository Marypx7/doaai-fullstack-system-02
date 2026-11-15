import nodemailer from 'nodemailer';

const REPORT_RECIPIENT = 'doaai@gmail.com';
let transporterPromise;
let transporterConfigKey;
let emailFrom;
let isEthereal = false;

async function getTransporter() {
  const configKey = JSON.stringify({
    mode: process.env.EMAIL_MODE || 'smtp',
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
    secure: process.env.SMTP_SECURE
  });
  if (!transporterPromise || transporterConfigKey !== configKey) {
    transporterConfigKey = configKey;
    transporterPromise = (async () => {
      const emailMode = process.env.EMAIL_MODE || 'smtp';
      if (emailMode === 'ethereal') {
        const account = await nodemailer.createTestAccount();
        emailFrom = 'DoaAí <doaai@example.com>';
        isEthereal = true;
        return nodemailer.createTransport({
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          auth: { user: account.user, pass: account.pass }
        });
      }
      isEthereal = false;
      if (emailMode !== 'smtp') {
        throw new Error('EMAIL_MODE deve ser smtp ou ethereal.');
      }

      const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
      const port = Number(SMTP_PORT);
      if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Configure EMAIL_MODE=ethereal ou SMTP_HOST e SMTP_PORT para envio de e-mails.');
      }
      emailFrom = process.env.SMTP_FROM || SMTP_USER;
      if (!emailFrom) {
        throw new Error('Configure SMTP_FROM ou SMTP_USER para identificar o remetente dos e-mails.');
      }
      if ((SMTP_USER && !SMTP_PASSWORD) || (!SMTP_USER && SMTP_PASSWORD)) {
        throw new Error('SMTP_USER e SMTP_PASSWORD devem ser configurados juntos.');
      }

      return nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true',
        ...(SMTP_USER && SMTP_PASSWORD ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {})
      });
    })().catch((error) => {
      if (transporterConfigKey === configKey) {
        transporterPromise = undefined;
        transporterConfigKey = undefined;
      }
      throw error;
    });
  }
  return transporterPromise;
}

function getProductLink(productId) {
  return getPublicAppLink(`/produtos/${productId}`);
}

function getPublicAppLink(path) {
  const configuredUrl = process.env.PUBLIC_APP_URL;
  if (!configuredUrl) {
    throw new Error('Configure PUBLIC_APP_URL para gerar links enviados por e-mail.');
  }
  const baseUrl = new URL(configuredUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol) ||
      (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')) {
    throw new Error('PUBLIC_APP_URL deve utilizar HTTPS em produção.');
  }
  return new URL(path, baseUrl).toString();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export async function sendReportEmail({ report, product, reporterId }) {
  const transporter = await getTransporter();
  const productId = report.productId.toString();
  const date = report.createdAt.toISOString();
  const description = report.description || 'Não informada';
  const link = getProductLink(productId);
  const info = await transporter.sendMail({
    from: emailFrom,
    to: REPORT_RECIPIENT,
    subject: `[DoaAí] Nova denúncia de publicação — ${productId}`,
    text: [
      'Nova denúncia recebida pela plataforma DoaAí.',
      '',
      'Dados da publicação:',
      `- Produto: ${product.name}`,
      `- ID: ${productId}`,
      `- Link: ${link}`,
      '',
      'Informações da denúncia:',
      `- Motivo: ${report.reason}`,
      `- Descrição: ${description}`,
      `- Data e horário: ${date}`,
      '',
      'Informações do denunciante:',
      `- ID do usuário autenticado: ${reporterId}`,
      '',
      'Esta mensagem foi gerada automaticamente pelo sistema DoaAí.'
    ].join('\n')
  });

  if (isEthereal) {
    console.info('Pré-visualização do e-mail de denúncia:', nodemailer.getTestMessageUrl(info));
  }
}

export async function sendPasswordResetEmail({ to, name, token }) {
  const transporter = await getTransporter();
  const link = new URL(getPublicAppLink('/redefinir-senha'));
  link.hash = new URLSearchParams({ token }).toString();
  const safeName = escapeHtml(name || 'pessoa');
  const safeLink = escapeHtml(link.toString());
  await transporter.sendMail({
    from: emailFrom,
    to,
    subject: '[DoaAí] Redefinição de senha',
    text: [
      `Olá, ${name || 'pessoa'}.`,
      '',
      'Recebemos uma solicitação para redefinir a senha da sua conta DoaAí.',
      `Redefina sua senha neste link: ${link.toString()}`,
      '',
      'Este link expira em 15 minutos.',
      'Se você não solicitou a redefinição, ignore este e-mail. Sua senha permanecerá inalterada.'
    ].join('\n'),
    html: [
      '<!doctype html>',
      '<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#24342a;line-height:1.6">',
      '<main style="max-width:560px;margin:32px auto;padding:24px;border:1px solid #e1e8e2;border-radius:12px">',
      '<h1 style="color:#43835a">DoaAí</h1>',
      `<p>Olá, ${safeName}.</p>`,
      '<p>Recebemos uma solicitação para redefinir a senha da sua conta DoaAí.</p>',
      `<p><a href="${safeLink}" style="display:inline-block;padding:12px 20px;background:#43835a;color:#fff;text-decoration:none;border-radius:8px">Redefinir minha senha</a></p>`,
      '<p>Este link expira em 15 minutos.</p>',
      '<p>Se você não solicitou a redefinição, ignore este e-mail. Sua senha permanecerá inalterada.</p>',
      '</main></body></html>'
    ].join('')
  });
}
