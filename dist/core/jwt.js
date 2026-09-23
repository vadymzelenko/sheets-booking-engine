"use strict";
// src/core/jwt.ts
// Тонкая обёртка над jsonwebtoken для трёх типов токенов, которые использует движок:
// confirm_booking (ссылка подтверждения), login (magic link), session (cookie в дашборде).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
exports.verifyToken = verifyToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function signToken(payload, secret, expiresInMinutes) {
    return jsonwebtoken_1.default.sign(payload, secret, { expiresIn: `${expiresInMinutes}m` });
}
function verifyToken(token, secret) {
    try {
        return jsonwebtoken_1.default.verify(token, secret);
    }
    catch {
        // просроченный или подделанный токен — просто считаем его недействительным
        return null;
    }
}
