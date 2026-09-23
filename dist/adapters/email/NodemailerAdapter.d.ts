import type { IEmailProvider } from "../../types";
export interface NodemailerAdapterConfig {
    /** ваш gmail-адрес, например booking.notifications@gmail.com */
    gmailUser: string;
    /** App Password из настроек Google-аккаунта (16 символов), НЕ обычный пароль */
    gmailAppPassword: string;
    /** Отображаемое имя отправителя, напр. "Booking System" */
    fromName?: string;
}
export declare class NodemailerAdapter implements IEmailProvider {
    private config;
    private transporter;
    constructor(config: NodemailerAdapterConfig);
    sendMail(params: {
        to: string;
        subject: string;
        html: string;
        text?: string;
    }): Promise<void>;
}
