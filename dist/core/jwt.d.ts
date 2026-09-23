export type TokenPurpose = "confirm_booking" | "login" | "session";
export interface TokenPayload {
    purpose: TokenPurpose;
    bookingId?: string;
    email?: string;
}
export declare function signToken(payload: TokenPayload, secret: string, expiresInMinutes: number): string;
export declare function verifyToken<T extends TokenPayload = TokenPayload>(token: string, secret: string): T | null;
