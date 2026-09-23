// src/types.ts
// Базовые типы и контракты (интерфейсы) движка бронирования.
// Библиотека не завязана на конкретную реализацию хранилища, почты или блокировок —
// всё внедряется через конструктор BookingEngine (Dependency Injection).

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  phone: string;
  createdAt: string; // ISO 8601
  [key: string]: unknown; // произвольные кастомные поля
}

/** Работник/ресурс (мастер, парикмахер и т.п.), который принимает записи. */
export interface ResourceRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface BookingRecord {
  id: string;
  userEmail: string;
  /** Работник, на которого сделана запись. */
  resourceId: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  serviceData: string; // JSON-строка с произвольными данными об услуге
  status: BookingStatus;
  token: string;
  createdAt: string; // ISO 8601
}

export interface LogRecord {
  timestamp: string; // ISO 8601
  action: string;
  email: string;
  details: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  phone: string;
  [key: string]: unknown;
}

export interface CreateResourceInput {
  name: string;
  [key: string]: unknown;
}

export interface CreateBookingInput {
  userEmail: string;
  /** Необязательно: если не задан — запись «без мастера» (общий слот). */
  resourceId?: string;
  startTime: string;
  endTime: string;
  serviceData?: Record<string, unknown>;
}

/**
 * Абстракция над хранилищем данных. AppsScriptAdapter — реализация поверх Google Sheets
 * (через Apps Script). Можно подставить Postgres/Airtable/что угодно, реализовав интерфейс.
 */
/** Входные данные для атомарного резервирования слота (одна операция "проверка + запись"). */
export interface ReserveSlotInput {
  id: string;
  userEmail: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  serviceData: string; // JSON-строка с данными услуги
  token: string;
  /** ISO 8601: PENDING-брони старше этого времени считаются свободными. */
  staleBefore: string;
}

export type ReserveSlotResult =
  | { reserved: true; booking: BookingRecord }
  | { reserved: false; reason: "SLOT_TAKEN" | "LOCK_BUSY" };

/** Один слот календаря занятости + список свободных работников. */
export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  freeResourceIds: string[];
}

export interface IBookingStorage {
  // Users
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;

  // Resources (работники)
  listResources(): Promise<ResourceRecord[]>;
  createResource(input: CreateResourceInput): Promise<ResourceRecord>;
  deleteResource(id: string): Promise<void>;

  // Bookings
  findBookingById(id: string): Promise<BookingRecord | null>;
  findBookingsInRange(startTime: string, endTime: string): Promise<BookingRecord[]>;
  createBooking(
    record: Omit<BookingRecord, "id" | "createdAt"> & { id?: string }
  ): Promise<BookingRecord>;
  updateBookingStatus(id: string, status: BookingStatus): Promise<void>;
  updateBookingTime(id: string, startTime: string, endTime: string): Promise<void>;
  listBookingsByUser(email: string): Promise<BookingRecord[]>;
  listBookings(): Promise<BookingRecord[]>;
  deleteBooking(id: string): Promise<void>;

  /**
   * Опциональная атомарная операция "проверить слот и зарезервировать" за один вызов.
   * Если хранилище реализует её (AppsScriptAdapter), движок использует её и экономит
   * один round-trip. Иначе откатывается на isSlotAvailable + createBooking.
   */
  reserveSlot?(input: ReserveSlotInput): Promise<ReserveSlotResult>;

  // Logs
  appendLog(log: LogRecord): Promise<void>;
  listLogs(): Promise<LogRecord[]>;

  /** Пересобрать человекочитаемый лист «Отчёт» (специфично для Apps Script). */
  rebuildReport?(): Promise<void>;
}

export interface IEmailProvider {
  sendMail(params: { to: string; subject: string; html: string; text?: string }): Promise<void>;
}

export interface ILockProvider {
  /**
   * Пытается захватить блокировку по ключу на указанное время (мс).
   * Возвращает функцию release() для снятия блокировки, либо null, если захватить не удалось.
   */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

export interface BookingEngineConfig {
  storage: IBookingStorage;
  emailProvider: IEmailProvider;
  /** Реализация блокировки. По умолчанию — MemoryLockAdapter. */
  lockProvider?: ILockProvider;
  jwtSecret: string;
  /** Базовый URL приложения, используется для ссылок /api/confirm и /api/login */
  baseUrl: string;
  /** Сколько минут PENDING-бронь удерживает слот. По умолчанию 15. */
  pendingTtlMinutes?: number;
  /** TTL JWT-токена в письме подтверждения (мин). По умолчанию 30. */
  confirmTokenTtlMinutes?: number;
  /** TTL JWT-токена в письме входа (мин). По умолчанию 15. */
  loginTokenTtlMinutes?: number;
  /** TTL сессионной cookie (дни). По умолчанию 30. */
  sessionTtlDays?: number;
}
