import type { IEmailProvider } from "../../types";
export interface ResendAdapterConfig {
    apiKey: string;
    /** Напр. "Booking <booking@yourdomain.com>" — домен должен быть подтверждён в Resend */
    fromEmail: string;
}
export declare class ResendAdapter implements IEmailProvider {
    private config;
    private client;
    constructor(config: ResendAdapterConfig);
    sendMail(params: {
        to: string;
        subject: string;
        html: string;
        text?: string;
    }): Promise<void>;
}
