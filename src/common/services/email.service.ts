import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Email service configured (${host}:${port})`);
    } else {
      this.logger.warn('SMTP not configured — emails will be logged only. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    }
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
    const subject = 'Redefinição de senha — RazePague';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d0d14;border-radius:16px;border:1px solid rgba(138,43,226,0.2);overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#8A2BE2,#5e18a0);padding:30px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">RazePague</h1>
            <p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:13px;">Gateway de Pagamentos</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <p style="color:#e5e7eb;font-size:15px;margin:0 0 12px;">Olá, <strong style="color:#fff;">${name}</strong>!</p>
            <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 28px;">
              Recebemos uma solicitação para redefinir a senha da sua conta.
              Clique no botão abaixo para criar uma nova senha:
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#8A2BE2,#6a0dad);border-radius:10px;padding:0;">
                  <a href="${resetUrl}"
                    style="display:inline-block;padding:14px 36px;color:#fff;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">
                    Redefinir Senha
                  </a>
                </td>
              </tr>
            </table>
            <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0 0 8px;">
              Este link expira em <strong style="color:#9ca3af;">1 hora</strong>.
              Se você não solicitou a redefinição, ignore este e-mail.
            </p>
            <p style="color:#6b7280;font-size:11px;margin:0;word-break:break-all;">
              Link: <a href="${resetUrl}" style="color:#8A2BE2;">${resetUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
            <p style="color:#4b5563;font-size:11px;margin:0;">© 2024 RazePague · Todos os direitos reservados</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.sendMail(to, subject, html);
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    const from = this.configService.get<string>('SMTP_FROM', 'noreply@razepague.com');

    if (!this.transporter) {
      // Log email in development when SMTP not configured
      this.logger.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[EMAIL] (SMTP not configured — email not sent)`);
      return;
    }

    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Email sent to ${to}: "${subject}"`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      throw err;
    }
  }
}
