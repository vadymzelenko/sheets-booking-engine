// src/adapters/email/ResendAdapter.ts
// Реализация IEmailProvider через Resend (https://resend.com), пакет "resend".

import { Resend } from "resend";
import type { IEmailProvider } from "../../types";

export interface ResendAdapterConfig {
  apiKey: string;
  /** Напр. "Booking <booking@yourdomain.com>" — домен должен быть подтверждён в Resend */
  fromEmail: string;
}

export class ResendAdapter implements IEmailProvider {
  private client: Resend;

  constructor(private config: ResendAdapterConfig) {
    this.client = new Resend(config.apiKey);
  }

  async sendMail(params: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.config.fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      throw new Error(`ResendAdapter: не удалось отправить письмо — ${error.message}`);
    }
  }
}
