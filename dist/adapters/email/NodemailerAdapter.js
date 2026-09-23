"use strict";
// src/adapters/email/NodemailerAdapter.ts
// Реализация IEmailProvider через обычный Gmail-аккаунт по SMTP (пакет "nodemailer").
//
// Требования:
//  1. На аккаунте Gmail включена двухфакторная аутентификация.
//  2. Сгенерирован App Password: https://myaccount.google.com/apppasswords
//     (обычный пароль от аккаунта Google для SMTP не подойдёт).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodemailerAdapter = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
class NodemailerAdapter {
    constructor(config) {
        this.config = config;
        this.transporter = nodemailer_1.default.createTransport({
            service: "gmail",
            auth: {
                user: config.gmailUser,
                pass: config.gmailAppPassword,
            },
        });
    }
    async sendMail(params) {
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
exports.NodemailerAdapter = NodemailerAdapter;
