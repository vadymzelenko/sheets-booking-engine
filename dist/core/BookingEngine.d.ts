import type { BookingEngineConfig, BookingRecord, CreateBookingInput, ResourceRecord, CreateResourceInput, AvailabilitySlot, UserRecord, LogRecord, BookingStatus } from "../types";
export declare class BookingEngineError extends Error {
    code: string;
    constructor(message: string, code: string);
}
export declare class BookingEngine {
    private storage;
    private emailProvider;
    private lockProvider;
    private jwtSecret;
    private baseUrl;
    private pendingTtlMinutes;
    private confirmTokenTtlMinutes;
    private loginTokenTtlMinutes;
    private sessionTtlDays;
    constructor(config: BookingEngineConfig);
    private slotKey;
    /**
     * Запускает фоновое действие, не блокируя ответ пользователю.
     * Используется для логов и писем, которые не влияют на результат запроса.
     * Ошибки логируются, чтобы не ронять весь запрос из-за необязательных операций.
     */
    private fireAndForget;
    /** Проверяет, блокирует ли какая-либо бронь слот указанного работника. */
    private isBlocked;
    /** true, если слот свободен у указанного работника. */
    isSlotAvailable(startTime: string, endTime: string, resourceId: string, excludeBookingId?: string): Promise<boolean>;
    listResources(): Promise<ResourceRecord[]>;
    createResource(input: CreateResourceInput): Promise<ResourceRecord>;
    deleteResource(resourceId: string): Promise<void>;
    /**
     * Календарь занятости: разбивает диапазон на слоты и для каждого возвращает,
     * какие работники свободны. Удобно для показа клиентам свободных окон.
     */
    getAvailability(startTime: string, endTime: string, slotMinutes: number): Promise<{
        resources: ResourceRecord[];
        slots: AvailabilitySlot[];
    }>;
    /**
     * Шаг 1 Flow нового/существующего пользователя: пользователь отправил форму.
     * Создаёт PENDING-бронь, удерживающую слот pendingTtlMinutes минут, и шлёт письмо
     * со ссылкой подтверждения /api/confirm?token=...
     */
    requestBooking(input: CreateBookingInput & {
        name?: string;
        phone?: string;
    }): Promise<BookingRecord>;
    /** Шаг 2: переход по ссылке из письма подтверждения. */
    confirmBooking(token: string): Promise<BookingRecord>;
    /** Создаёт пользователя, если его ещё нет (идемпотентно). */
    private ensureUser;
    /** Flow существующего пользователя, шаг 1: запрос magic link по email. */
    requestLogin(email: string): Promise<void>;
    /**
     * Flow существующего пользователя, шаг 2: переход по magic link.
     * Возвращает данные, которые API route должен положить в HTTP-only cookie.
     */
    verifyLoginToken(token: string): Promise<{
        email: string;
        sessionToken: string;
        sessionTtlDays: number;
    }>;
    /** Проверка session-cookie — используйте в middleware/API роутах дашборда. */
    verifySession(sessionToken: string): {
        email: string;
    } | null;
    /** Создаёт сессионный токен для email (например, сразу после подтверждения брони). */
    createSession(email: string): {
        sessionToken: string;
        sessionTtlDays: number;
    };
    listUserBookings(email: string): Promise<BookingRecord[]>;
    listAllBookings(): Promise<BookingRecord[]>;
    listUsers(): Promise<UserRecord[]>;
    listLogs(): Promise<LogRecord[]>;
    deleteBooking(bookingId: string): Promise<void>;
    /** Прямое изменение статуса (для CRM, без проверки владельца). */
    setBookingStatus(bookingId: string, status: BookingStatus): Promise<void>;
    /** Пересобрать человекочитаемый лист «Отчёт» (если хранилище поддерживает). */
    rebuildReport(): Promise<void>;
    cancelBooking(bookingId: string, requesterEmail: string): Promise<void>;
    rescheduleBooking(bookingId: string, requesterEmail: string, newStartTime: string, newEndTime: string): Promise<BookingRecord>;
}
