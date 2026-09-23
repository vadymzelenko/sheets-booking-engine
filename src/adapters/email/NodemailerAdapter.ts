// src/adapters/email/NodemailerAdapter.ts
// Реализация IEmailProvider через обычный Gmail-аккаунт по SMTP (пакет "nodemailer").
//
// Требования:
//  1. На аккаунте Gmail включена двухфакторная аутентификация.
//  2. Сгенерирован App Password: https://myaccount.google.com/apppasswords
//     (обычный пароль от аккаунта Google для SMTP не подойдёт).

import nodemailer, { type Transporter } from "nodemailer";
import type { IEmailProvider } from "../../types";

export interface NodemailerAdapterConfig {
  /** ваш gmail-адрес, например booking.notifications@gmail.com */
  gmailUser: string;
  /** App Password из настроек Google-аккаунта (16 символов), НЕ обычный пароль */
  gmailAppPassword: string;
  /** Отображаемое имя отправителя, напр. "Booking System" */
  fromName?: string;
}

export class NodemailerAdapter implements IEmailProvider {
  private transporter: Transporter;

  constructor(private config: NodemailerAdapterConfig) {
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    });
  }

  async sendMail(params: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.fromName
        ? `"${this.config.fromName}" <${this.config.gmailUser}>`
        : this.config.gmailUser,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }
}
