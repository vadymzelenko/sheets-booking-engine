// src/core/jwt.ts
// Тонкая обёртка над jsonwebtoken для трёх типов токенов, которые использует движок:
// confirm_booking (ссылка подтверждения), login (magic link), session (cookie в дашборде).

import jwt from "jsonwebtoken";

export type TokenPurpose = "confirm_booking" | "login" | "session";

export interface TokenPayload {
  purpose: TokenPurpose;
  bookingId?: string;
  email?: string;
}

export function signToken(payload: TokenPayload, secret: string, expiresInMinutes: number): string {
  return jwt.sign(payload, secret, { expiresIn: `${expiresInMinutes}m` });
}

export function verifyToken<T extends TokenPayload = TokenPayload>(
  token: string,
  secret: string
): T | null {
  try {
    return jwt.verify(token, secret) as T;
  } catch {
    // просроченный или подделанный токен — просто считаем его недействительным
    return null;
  }
}
