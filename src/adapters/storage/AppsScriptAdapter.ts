// src/adapters/storage/AppsScriptAdapter.ts
// Реализация IBookingStorage через Google Apps Script Web App.
//
// Позволяет писать в Google Sheets БЕЗ Service Account и Google Cloud Console:
// разворачивается Apps Script (см. apps-script/Code.gs), который открывает таблицу
// от имени владельца скрипта и принимает JSON-запросы по HTTP. Адаптер на стороне
// Node просто шлёт эти запросы на URL web app.
//
// Защита: каждый запрос содержит общий секрет (APPS_SCRIPT_SECRET), который
// проверяется на стороне скрипта.

import type {
  IBookingStorage,
  UserRecord,
  BookingRecord,
  LogRecord,
  CreateUserInput,
  CreateResourceInput,
  ResourceRecord,
  BookingStatus,
  ReserveSlotInput,
  ReserveSlotResult,
} from "../../types";

export interface AppsScriptAdapterConfig {
  /** URL развёрнутого web app, напр. https://script.google.com/macros/s/.../exec */
  webAppUrl: string;
  /** Общий секрет, совпадает с CONFIG.SECRET в Code.gs */
  secret: string;
  /** Для тестов — можно подменить fetch. */
  fetchImpl?: typeof fetch;
}

interface AppsScriptResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class AppsScriptAdapter implements IBookingStorage {
  private webAppUrl: string;
  private secret: string;
  private fetchImpl: typeof fetch;

  constructor(config: AppsScriptAdapterConfig) {
    this.webAppUrl = config.webAppUrl.replace(/\/+$/, "");
    this.secret = config.secret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: this.secret, action, params }),
      });
    } catch (err) {
      throw new Error(`AppsScriptAdapter: network error — ${(err as Error).message}`);
    }

    if (!res.ok) {
      throw new Error(`AppsScriptAdapter: HTTP ${res.status}`);
    }

    const json = (await res.json()) as AppsScriptResponse<T>;
    if (typeof json.ok !== "boolean") {
      throw new Error(
        "AppsScriptAdapter: неожиданный формат ответа от Apps Script (нет поля 'ok'). " +
          "Убедитесь, что развёрнут apps-script/Code.gs из репозитория, а не произвольный doPost."
      );
    }
    if (!json.ok) {
      throw new Error(`AppsScriptAdapter: ${json.error ?? "unknown error"}`);
    }

    return json.data as T;
  }

  /** Проверка соединения с Apps Script (не входит в IBookingStorage). */
  async ping(): Promise<boolean> {
    const data = await this.call<{ pong?: boolean }>("ping");
    return data?.pong === true;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.call<UserRecord | null>("findUserByEmail", { email });
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    return this.call<UserRecord>("createUser", { ...input });
  }

  async listResources(): Promise<ResourceRecord[]> {
    return this.call<ResourceRecord[]>("listResources");
  }

  async createResource(input: CreateResourceInput): Promise<ResourceRecord> {
    return this.call<ResourceRecord>("createResource", { ...input });
  }

  async deleteResource(id: string): Promise<void> {
    await this.call<null>("deleteResource", { id });
  }

  async findBookingById(id: string): Promise<BookingRecord | null> {
    return this.call<BookingRecord | null>("findBookingById", { id });
  }

  async findBookingsInRange(startTime: string, endTime: string): Promise<BookingRecord[]> {
    return this.call<BookingRecord[]>("findBookingsInRange", { startTime, endTime });
  }

  async createBooking(
    record: Omit<BookingRecord, "id" | "createdAt"> & { id?: string }
  ): Promise<BookingRecord> {
    return this.call<BookingRecord>("createBooking", { ...record });
  }

  /** Атомарная проверка + запись слота за один round-trip к Apps Script. */
  async reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult> {
    return this.call<ReserveSlotResult>("reserveSlot", { ...input });
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<void> {
    await this.call<null>("updateBookingStatus", { id, status });
  }

  async updateBookingTime(id: string, startTime: string, endTime: string): Promise<void> {
    await this.call<null>("updateBookingTime", { id, startTime, endTime });
  }

  async listBookingsByUser(email: string): Promise<BookingRecord[]> {
    return this.call<BookingRecord[]>("listBookingsByUser", { email });
  }

  async listBookings(): Promise<BookingRecord[]> {
    return this.call<BookingRecord[]>("listBookings");
  }

  async deleteBooking(id: string): Promise<void> {
    await this.call<null>("deleteBooking", { id });
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.call<UserRecord[]>("listUsers");
  }

  async appendLog(log: LogRecord): Promise<void> {
    await this.call<null>("appendLog", { ...log });
  }

  async listLogs(): Promise<LogRecord[]> {
    return this.call<LogRecord[]>("listLogs");
  }

  /** Пересобрать человекочитаемый лист «Отчёт» в таблице. */
  async rebuildReport(): Promise<void> {
    await this.call<{ rebuilt: boolean }>("rebuildReport");
  }

  /** Динамически добавляет кастомную колонку в лист. */
  async ensureCustomColumn(sheet: "users" | "bookings", columnName: string): Promise<void> {
    await this.call<null>("ensureCustomColumn", { sheet, columnName });
  }
}
