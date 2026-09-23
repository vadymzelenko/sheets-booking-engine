import type { IBookingStorage, UserRecord, BookingRecord, LogRecord, CreateUserInput, CreateResourceInput, ResourceRecord, BookingStatus, ReserveSlotInput, ReserveSlotResult } from "../../types";
export interface AppsScriptAdapterConfig {
    /** URL развёрнутого web app, напр. https://script.google.com/macros/s/.../exec */
    webAppUrl: string;
    /** Общий секрет, совпадает с CONFIG.SECRET в Code.gs */
    secret: string;
    /** Для тестов — можно подменить fetch. */
    fetchImpl?: typeof fetch;
}
export declare class AppsScriptAdapter implements IBookingStorage {
    private webAppUrl;
    private secret;
    private fetchImpl;
    constructor(config: AppsScriptAdapterConfig);
    private call;
    /** Проверка соединения с Apps Script (не входит в IBookingStorage). */
    ping(): Promise<boolean>;
    findUserByEmail(email: string): Promise<UserRecord | null>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
    listResources(): Promise<ResourceRecord[]>;
    createResource(input: CreateResourceInput): Promise<ResourceRecord>;
    deleteResource(id: string): Promise<void>;
    findBookingById(id: string): Promise<BookingRecord | null>;
    findBookingsInRange(startTime: string, endTime: string): Promise<BookingRecord[]>;
    createBooking(record: Omit<BookingRecord, "id" | "createdAt"> & {
        id?: string;
    }): Promise<BookingRecord>;
    /** Атомарная проверка + запись слота за один round-trip к Apps Script. */
    reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult>;
    updateBookingStatus(id: string, status: BookingStatus): Promise<void>;
    updateBookingTime(id: string, startTime: string, endTime: string): Promise<void>;
    listBookingsByUser(email: string): Promise<BookingRecord[]>;
    listBookings(): Promise<BookingRecord[]>;
    deleteBooking(id: string): Promise<void>;
    listUsers(): Promise<UserRecord[]>;
    appendLog(log: LogRecord): Promise<void>;
    listLogs(): Promise<LogRecord[]>;
    /** Пересобрать человекочитаемый лист «Отчёт» в таблице. */
    rebuildReport(): Promise<void>;
    /** Динамически добавляет кастомную колонку в лист. */
    ensureCustomColumn(sheet: "users" | "bookings", columnName: string): Promise<void>;
}
