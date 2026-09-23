"use strict";
// src/adapters/email/ResendAdapter.ts
// Реализация IEmailProvider через Resend (https://resend.com), пакет "resend".
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResendAdapter = void 0;
const resend_1 = require("resend");
class ResendAdapter {
    constructor(config) {
        this.config = config;
        this.client = new resend_1.Resend(config.apiKey);
    }
    async sendMail(params) {
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
exports.ResendAdapter = ResendAdapter;
