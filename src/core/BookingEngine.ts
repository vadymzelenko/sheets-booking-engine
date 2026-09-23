// src/core/BookingEngine.ts
// Ядро библиотеки. Ничего не знает про Google Sheets/Resend/Redis конкретно —
// работает только через интерфейсы IBookingStorage / IEmailProvider / ILockProvider,
// которые передаются снаружи (Dependency Injection). Это и делает движок BaaS-подобным:
// подключается в любой Next.js App Router проект как обычная библиотека.

import { randomUUID } from "crypto";
import type {
  IBookingStorage,
  IEmailProvider,
  ILockProvider,
  BookingEngineConfig,
  BookingRecord,
  CreateBookingInput,
  ResourceRecord,
  CreateResourceInput,
  AvailabilitySlot,
  UserRecord,
  LogRecord,
  BookingStatus,
} from "../types";
import { signToken, verifyToken } from "./jwt";
import { nowIso, minutesAgoIso, isRangeOverlap, generateSlots } from "./dates";
import { MemoryLockAdapter } from "../adapters/lock/MemoryLockAdapter";

const DEFAULT_PENDING_TTL_MINUTES = 15;
const DEFAULT_CONFIRM_TOKEN_TTL_MINUTES = 30;
const DEFAULT_LOGIN_TOKEN_TTL_MINUTES = 15;
const DEFAULT_SESSION_TTL_DAYS = 30;
const LOCK_TTL_MS = 3000; // окно жёсткой блокировки слота на время транзакции записи

export class BookingEngineError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "BookingEngineError";
  }
}

export class BookingEngine {
  private storage: IBookingStorage;
  private emailProvider: IEmailProvider;
  private lockProvider: ILockProvider;
  private jwtSecret: string;
  private baseUrl: string;
  private pendingTtlMinutes: number;
  private confirmTokenTtlMinutes: number;
  private loginTokenTtlMinutes: number;
  private sessionTtlDays: number;

  constructor(config: BookingEngineConfig) {
    this.storage = config.storage;
    this.emailProvider = config.emailProvider;
    this.lockProvider = config.lockProvider ?? new MemoryLockAdapter();
    this.jwtSecret = config.jwtSecret;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.pendingTtlMinutes = config.pendingTtlMinutes ?? DEFAULT_PENDING_TTL_MINUTES;
    this.confirmTokenTtlMinutes = config.confirmTokenTtlMinutes ?? DEFAULT_CONFIRM_TOKEN_TTL_MINUTES;
    this.loginTokenTtlMinutes = config.loginTokenTtlMinutes ?? DEFAULT_LOGIN_TOKEN_TTL_MINUTES;
    this.sessionTtlDays = config.sessionTtlDays ?? DEFAULT_SESSION_TTL_DAYS;
  }

  private slotKey(resourceId: string, startTime: string, endTime: string): string {
    return `slot:${resourceId}:${startTime}:${endTime}`;
  }

  /**
   * Запускает фоновое действие, не блокируя ответ пользователю.
   * Используется для логов и писем, которые не влияют на результат запроса.
   * Ошибки логируются, чтобы не ронять весь запрос из-за необязательных операций.
   */
  private fireAndForget(promise: Promise<unknown>, context: string): void {
    promise.catch((err) => {
      console.error(`[BookingEngine] ${context} (фоновое действие):`, err);
    });
  }

  /** Проверяет, блокирует ли какая-либо бронь слот указанного работника. */
  private isBlocked(
    bookings: BookingRecord[],
    resourceId: string,
    startTime: string,
    endTime: string,
    staleBefore: string,
    excludeBookingId?: string
  ): boolean {
    return bookings.some((b) => {
      if (excludeBookingId && b.id === excludeBookingId) return false;
      if (b.resourceId !== resourceId) return false; // занятость у каждого работника своя
      if (b.status === "CANCELLED") return false;
      if (b.status === "PENDING" && b.createdAt < staleBefore) return false; // слот освобождён
      return isRangeOverlap(b.startTime, b.endTime, startTime, endTime);
    });
  }

  /** true, если слот свободен у указанного работника. */
  async isSlotAvailable(
    startTime: string,
    endTime: string,
    resourceId: string,
    excludeBookingId?: string
  ): Promise<boolean> {
    const overlapping = await this.storage.findBookingsInRange(startTime, endTime);
    const staleBefore = minutesAgoIso(this.pendingTtlMinutes);
    return !this.isBlocked(overlapping, resourceId, startTime, endTime, staleBefore, excludeBookingId);
  }

  async listResources(): Promise<ResourceRecord[]> {
    return this.storage.listResources();
  }

  async createResource(input: CreateResourceInput): Promise<ResourceRecord> {
    return this.storage.createResource(input);
  }

  async deleteResource(resourceId: string): Promise<void> {
    await this.storage.deleteResource(resourceId);
  }

  /**
   * Календарь занятости: разбивает диапазон на слоты и для каждого возвращает,
   * какие работники свободны. Удобно для показа клиентам свободных окон.
   */
  async getAvailability(
    startTime: string,
    endTime: string,
    slotMinutes: number
  ): Promise<{ resources: ResourceRecord[]; slots: AvailabilitySlot[] }> {
    const resources = await this.storage.listResources();
    const bookings = await this.storage.findBookingsInRange(startTime, endTime);
    const staleBefore = minutesAgoIso(this.pendingTtlMinutes);

    const slots = generateSlots(startTime, endTime, slotMinutes).map((s) => ({
      ...s,
      freeResourceIds: resources
        .filter((r) => !this.isBlocked(bookings, r.id, s.startTime, s.endTime, staleBefore))
        .map((r) => r.id),
    }));

    return { resources, slots };
  }

  /**
   * Шаг 1 Flow нового/существующего пользователя: пользователь отправил форму.
   * Создаёт PENDING-бронь, удерживающую слот pendingTtlMinutes минут, и шлёт письмо
   * со ссылкой подтверждения /api/confirm?token=...
   */
  async requestBooking(
    input: CreateBookingInput & { name?: string; phone?: string }
  ): Promise<BookingRecord> {
    const resourceId = input.resourceId ?? "";
    const key = this.slotKey(resourceId, input.startTime, input.endTime);
    const release = await this.lockProvider.acquire(key, LOCK_TTL_MS);
    if (!release) {
      throw new BookingEngineError("Слот сейчас обрабатывается, попробуйте ещё раз", "LOCK_BUSY");
    }

    try {
      const bookingId = randomUUID();
      const token = signToken(
        { purpose: "confirm_booking", bookingId },
        this.jwtSecret,
        this.confirmTokenTtlMinutes
      );
      const serviceData = JSON.stringify({
        ...input.serviceData,
        name: input.name,
        phone: input.phone,
      });

      // Атомарное "проверка + запись" за один round-trip, если хранилище поддерживает.
      let booking: BookingRecord;
      if (this.storage.reserveSlot) {
        const result = await this.storage.reserveSlot({
          id: bookingId,
          userEmail: input.userEmail,
          resourceId,
          startTime: input.startTime,
          endTime: input.endTime,
          serviceData,
          token,
          staleBefore: minutesAgoIso(this.pendingTtlMinutes),
        });

        if (!result.reserved) {
          throw new BookingEngineError(
            result.reason === "LOCK_BUSY"
              ? "Слот сейчас обрабатывается, попробуйте ещё раз"
              : "Выбранное время уже занято",
            result.reason
          );
        }
        booking = result.booking;
      } else {
        const available = await this.isSlotAvailable(input.startTime, input.endTime, resourceId);
        if (!available) {
          throw new BookingEngineError("Выбранное время уже занято", "SLOT_TAKEN");
        }

        booking = await this.storage.createBooking({
          id: bookingId,
          userEmail: input.userEmail,
          resourceId,
          startTime: input.startTime,
          endTime: input.endTime,
          serviceData,
          status: "PENDING",
          token,
        });
      }

      this.fireAndForget(
        this.storage.appendLog({
          timestamp: nowIso(),
          action: "BOOKING_REQUESTED",
          email: input.userEmail,
          details: `Запрошена новая запись ${bookingId} на ${input.startTime}–${input.endTime}`,
        }),
        "лог BOOKING_REQUESTED"
      );

      const confirmUrl = `${this.baseUrl}/api/confirm?token=${encodeURIComponent(token)}`;
      const safeName = escapeHtml(input.name ?? "");
      const safeStart = escapeHtml(input.startTime);
      const safeEnd = escapeHtml(input.endTime);
      this.fireAndForget(
        this.emailProvider.sendMail({
          to: input.userEmail,
          subject: "Подтвердите запись",
          html: `<p>Здравствуйте${safeName ? `, ${safeName}` : ""}!</p>
<p>Подтвердите запись на <b>${safeStart}–${safeEnd}</b>, перейдя по ссылке:</p>
<p><a href="${confirmUrl}">${confirmUrl}</a></p>
<p>Ссылка действительна ${this.confirmTokenTtlMinutes} минут. Слот удерживается за вами ${this.pendingTtlMinutes} минут — если не успеть, придётся бронировать заново.</p>`,
        }),
        "письмо подтверждения"
      );

      return booking;
    } finally {
      await release();
    }
  }

  /** Шаг 2: переход по ссылке из письма подтверждения. */
  async confirmBooking(token: string): Promise<BookingRecord> {
    const payload = verifyToken(token, this.jwtSecret);
    if (!payload || payload.purpose !== "confirm_booking" || !payload.bookingId) {
      throw new BookingEngineError("Недействительная или просроченная ссылка", "INVALID_TOKEN");
    }

    const booking = await this.storage.findBookingById(payload.bookingId);
    if (!booking) {
      throw new BookingEngineError("Запись не найдена", "NOT_FOUND");
    }
    if (booking.status === "CANCELLED") {
      throw new BookingEngineError("Запись была отменена", "CANCELLED");
    }
    if (booking.status === "CONFIRMED") {
      return booking; // повторный переход по той же ссылке — идемпотентно
    }

    const staleBefore = minutesAgoIso(this.pendingTtlMinutes);
    if (booking.createdAt < staleBefore) {
      await this.storage.updateBookingStatus(booking.id, "CANCELLED");
      throw new BookingEngineError("Время удержания слота истекло, запись отменена", "EXPIRED");
    }

    // Обновление статуса и проверка/создание пользователя — независимые операции,
    // выполняем их параллельно, чтобы сократить время ответа.
    await Promise.all([
      this.storage.updateBookingStatus(booking.id, "CONFIRMED"),
      this.ensureUser(booking),
    ]);

    this.fireAndForget(
      this.storage.appendLog({
        timestamp: nowIso(),
        action: "BOOKING_CONFIRMED",
        email: booking.userEmail,
        details: `Запись ${booking.id} подтверждена`,
      }),
      "лог BOOKING_CONFIRMED"
    );

    return { ...booking, status: "CONFIRMED" };
  }

  /** Создаёт пользователя, если его ещё нет (идемпотентно). */
  private async ensureUser(booking: BookingRecord): Promise<void> {
    const existing = await this.storage.findUserByEmail(booking.userEmail);
    if (existing) return;

    const serviceData = safeParse(booking.serviceData);
    await this.storage.createUser({
      email: booking.userEmail,
      name: (serviceData?.name as string) ?? "",
      phone: (serviceData?.phone as string) ?? "",
    });
  }

  /** Flow существующего пользователя, шаг 1: запрос magic link по email. */
  async requestLogin(email: string): Promise<void> {
    const user = await this.storage.findUserByEmail(email);
    if (!user) {
      // Намеренно не сообщаем вызывающей стороне, есть ли такой email в базе —
      // ответ на фронтенде должен быть одинаковым в обоих случаях.
      return;
    }

    const token = signToken({ purpose: "login", email }, this.jwtSecret, this.loginTokenTtlMinutes);
    const loginUrl = `${this.baseUrl}/api/login?token=${encodeURIComponent(token)}`;

    this.fireAndForget(
      this.storage.appendLog({
        timestamp: nowIso(),
        action: "LOGIN_REQUESTED",
        email,
        details: "Запрошена ссылка для входа",
      }),
      "лог LOGIN_REQUESTED"
    );

    this.fireAndForget(
      this.emailProvider.sendMail({
        to: email,
        subject: "Ссылка для входа",
        html: `<p>Перейдите по ссылке, чтобы войти в личный кабинет:</p>
<p><a href="${loginUrl}">${loginUrl}</a></p>
<p>Ссылка действительна ${this.loginTokenTtlMinutes} минут.</p>`,
      }),
      "письмо для входа"
    );
  }

  /**
   * Flow существующего пользователя, шаг 2: переход по magic link.
   * Возвращает данные, которые API route должен положить в HTTP-only cookie.
   */
  async verifyLoginToken(
    token: string
  ): Promise<{ email: string; sessionToken: string; sessionTtlDays: number }> {
    const payload = verifyToken(token, this.jwtSecret);
    if (!payload || payload.purpose !== "login" || !payload.email) {
      throw new BookingEngineError("Недействительная или просроченная ссылка", "INVALID_TOKEN");
    }

    const sessionToken = signToken(
      { purpose: "session", email: payload.email },
      this.jwtSecret,
      this.sessionTtlDays * 24 * 60
    );

    this.fireAndForget(
      this.storage.appendLog({
        timestamp: nowIso(),
        action: "LOGIN_SUCCESS",
        email: payload.email,
        details: "Вход выполнен по magic link",
      }),
      "лог LOGIN_SUCCESS"
    );

    return { email: payload.email, sessionToken, sessionTtlDays: this.sessionTtlDays };
  }

  /** Проверка session-cookie — используйте в middleware/API роутах дашборда. */
  verifySession(sessionToken: string): { email: string } | null {
    const payload = verifyToken(sessionToken, this.jwtSecret);
    if (!payload || payload.purpose !== "session" || !payload.email) return null;
    return { email: payload.email };
  }

  /** Создаёт сессионный токен для email (например, сразу после подтверждения брони). */
  createSession(email: string): { sessionToken: string; sessionTtlDays: number } {
    const sessionToken = signToken(
      { purpose: "session", email },
      this.jwtSecret,
      this.sessionTtlDays * 24 * 60
    );
    return { sessionToken, sessionTtlDays: this.sessionTtlDays };
  }

  async listUserBookings(email: string): Promise<BookingRecord[]> {
    return this.storage.listBookingsByUser(email);
  }

  // --- Административные методы (для CRM) ---

  async listAllBookings(): Promise<BookingRecord[]> {
    return this.storage.listBookings();
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.storage.listUsers();
  }

  async listLogs(): Promise<LogRecord[]> {
    return this.storage.listLogs();
  }

  async deleteBooking(bookingId: string): Promise<void> {
    await this.storage.deleteBooking(bookingId);
  }

  /** Прямое изменение статуса (для CRM, без проверки владельца). */
  async setBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
    await this.storage.updateBookingStatus(bookingId, status);
  }

  /** Пересобрать человекочитаемый лист «Отчёт» (если хранилище поддерживает). */
  async rebuildReport(): Promise<void> {
    await this.storage.rebuildReport?.();
  }

  async cancelBooking(bookingId: string, requesterEmail: string): Promise<void> {
    const booking = await this.storage.findBookingById(bookingId);
    if (!booking) throw new BookingEngineError("Запись не найдена", "NOT_FOUND");
    if (booking.userEmail.toLowerCase() !== requesterEmail.toLowerCase()) {
      throw new BookingEngineError("Нет доступа к этой записи", "FORBIDDEN");
    }

    await this.storage.updateBookingStatus(bookingId, "CANCELLED");
    this.fireAndForget(
      this.storage.appendLog({
        timestamp: nowIso(),
        action: "BOOKING_CANCELLED",
        email: requesterEmail,
        details: `Запись ${bookingId} отменена пользователем`,
      }),
      "лог BOOKING_CANCELLED"
    );
  }

  async rescheduleBooking(
    bookingId: string,
    requesterEmail: string,
    newStartTime: string,
    newEndTime: string
  ): Promise<BookingRecord> {
    const booking = await this.storage.findBookingById(bookingId);
    if (!booking) throw new BookingEngineError("Запись не найдена", "NOT_FOUND");
    if (booking.userEmail.toLowerCase() !== requesterEmail.toLowerCase()) {
      throw new BookingEngineError("Нет доступа к этой записи", "FORBIDDEN");
    }

    const key = this.slotKey(booking.resourceId, newStartTime, newEndTime);
    const release = await this.lockProvider.acquire(key, LOCK_TTL_MS);
    if (!release) {
      throw new BookingEngineError("Слот сейчас обрабатывается, попробуйте ещё раз", "LOCK_BUSY");
    }

    try {
      const available = await this.isSlotAvailable(
        newStartTime,
        newEndTime,
        booking.resourceId,
        bookingId
      );
      if (!available) {
        throw new BookingEngineError("Выбранное время уже занято", "SLOT_TAKEN");
      }

      await this.storage.updateBookingTime(bookingId, newStartTime, newEndTime);
      this.fireAndForget(
        this.storage.appendLog({
          timestamp: nowIso(),
          action: "BOOKING_RESCHEDULED",
          email: requesterEmail,
          details: `Запись ${bookingId} перенесена на ${newStartTime}–${newEndTime}`,
        }),
        "лог BOOKING_RESCHEDULED"
      );

      return { ...booking, startTime: newStartTime, endTime: newEndTime };
    } finally {
      await release();
    }
  }
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Экранирует HTML-спецсимволы, чтобы пользовательский ввод не ломал письмо (XSS). */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
