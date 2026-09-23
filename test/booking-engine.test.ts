// test/booking-engine.test.ts
// QA-прогон бизнес-логики BookingEngine на in-memory хранилище и мок-почте.
// Запуск: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BookingEngine,
  BookingEngineError,
  MemoryLockAdapter,
} from "../src/index";
import type {
  IBookingStorage,
  IEmailProvider,
  ILockProvider,
  BookingEngineConfig,
  BookingRecord,
  UserRecord,
  ResourceRecord,
  LogRecord,
  CreateUserInput,
  CreateResourceInput,
  BookingStatus,
  ReserveSlotInput,
  ReserveSlotResult,
} from "../src/index";

// ---------------------------------------------------------------------------
// Моки (Dependency Injection)
// ---------------------------------------------------------------------------

class InMemoryStorage implements IBookingStorage {
  users = new Map<string, UserRecord>();
  bookings = new Map<string, BookingRecord>();
  resources = new Map<string, ResourceRecord>();
  logs: LogRecord[] = [];
  /** Искусственная задержка для расширения окна гонки в тестах concurrency. */
  delayMs = 0;

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return null;
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const id = `u_${this.users.size + 1}`;
    const { email, name, phone, ...rest } = input;
    const user: UserRecord = {
      id,
      email,
      name,
      phone,
      createdAt: new Date().toISOString(),
      ...rest,
    };
    this.users.set(id, user);
    return user;
  }

  async listResources(): Promise<ResourceRecord[]> {
    return [...this.resources.values()];
  }

  async createResource(input: CreateResourceInput): Promise<ResourceRecord> {
    const id = `r_${this.resources.size + 1}`;
    const resource: ResourceRecord = { id, ...input };
    this.resources.set(id, resource);
    return resource;
  }

  async deleteResource(id: string): Promise<void> {
    this.resources.delete(id);
  }

  async findBookingById(id: string): Promise<BookingRecord | null> {
    return this.bookings.get(id) ?? null;
  }

  async findBookingsInRange(startTime: string, endTime: string): Promise<BookingRecord[]> {
    if (this.delayMs) await sleep(this.delayMs);
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return [...this.bookings.values()].filter(
      (b) => new Date(b.startTime).getTime() < end && start < new Date(b.endTime).getTime()
    );
  }

  async createBooking(
    record: Omit<BookingRecord, "id" | "createdAt"> & { id?: string }
  ): Promise<BookingRecord> {
    const id = record.id ?? `b_${this.bookings.size + 1}`;
    const booking: BookingRecord = { ...record, id, createdAt: new Date().toISOString() };
    this.bookings.set(id, booking);
    return booking;
  }

  async updateBookingStatus(id: string, status: BookingStatus): Promise<void> {
    const b = this.bookings.get(id);
    if (!b) throw new Error(`Booking ${id} not found`);
    b.status = status;
  }

  async updateBookingTime(id: string, startTime: string, endTime: string): Promise<void> {
    const b = this.bookings.get(id);
    if (!b) throw new Error(`Booking ${id} not found`);
    b.startTime = startTime;
    b.endTime = endTime;
  }

  async listBookingsByUser(email: string): Promise<BookingRecord[]> {
    return [...this.bookings.values()].filter(
      (b) => b.userEmail.toLowerCase() === email.toLowerCase()
    );
  }

  async listBookings(): Promise<BookingRecord[]> {
    return [...this.bookings.values()];
  }

  async deleteBooking(id: string): Promise<void> {
    this.bookings.delete(id);
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.users.values()];
  }

  async appendLog(log: LogRecord): Promise<void> {
    this.logs.push(log);
  }

  async listLogs(): Promise<LogRecord[]> {
    return [...this.logs];
  }
}

class MockEmailProvider implements IEmailProvider {
  sent: { to: string; subject: string; html: string; text?: string }[] = [];

  async sendMail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    this.sent.push(params);
  }
}

function makeEngine(overrides: Partial<BookingEngineConfig> = {}) {
  const storage = new InMemoryStorage();
  const emailProvider = new MockEmailProvider();
  const engine = new BookingEngine({
    storage,
    emailProvider,
    jwtSecret: "test-secret",
    baseUrl: "http://localhost:3000",
    ...overrides,
  });
  return { engine, storage, emailProvider };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SLOT = {
  start: "2026-10-01T10:00:00.000Z",
  end: "2026-10-01T11:00:00.000Z",
};

function makeBooking(partial: Partial<BookingRecord>): BookingRecord {
  return {
    id: "x",
    userEmail: "x@y.z",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
    serviceData: "{}",
    status: "CONFIRMED",
    token: "t",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. Бронирование и управление слотами
// ---------------------------------------------------------------------------

test("requestBooking создаёт PENDING-бронь, пишет лог и отправляет письмо со ссылкой подтверждения", async () => {
  const { engine, storage, emailProvider } = makeEngine();

  const booking = await engine.requestBooking({
    userEmail: "client@example.com",
    resourceId: "w1",
    name: "Иван",
    phone: "+79991234567",
    startTime: SLOT.start,
    endTime: SLOT.end,
    serviceData: { service: "стрижка" },
  });

  assert.equal(booking.status, "PENDING");
  assert.equal(storage.bookings.size, 1);
  assert.ok(booking.token.length > 0);

  const log = storage.logs.find((l) => l.action === "BOOKING_REQUESTED");
  assert.ok(log, "должен быть лог BOOKING_REQUESTED");

  assert.equal(emailProvider.sent.length, 1);
  assert.match(emailProvider.sent[0].html, /\/api\/confirm\?token=/);
});

test("requestBooking отвергает слот, уже занятый CONFIRMED-бронью (SLOT_TAKEN)", async () => {
  const { engine, storage } = makeEngine();
  storage.bookings.set("existing", makeBooking({ id: "existing" }));

  await assert.rejects(
    engine.requestBooking({ userEmail: "new@y.z", resourceId: "w1", startTime: SLOT.start, endTime: SLOT.end }),
    (err: unknown) => err instanceof BookingEngineError && err.code === "SLOT_TAKEN"
  );
  assert.equal(storage.bookings.size, 1, "новая бронь не должна создаваться");
});

test("requestBooking возвращает LOCK_BUSY, если блокировку захватить не удалось", async () => {
  const neverLock: ILockProvider = { acquire: async () => null };
  const { engine } = makeEngine({ lockProvider: neverLock });

  await assert.rejects(
    engine.requestBooking({ userEmail: "a@b.c", resourceId: "w1", startTime: SLOT.start, endTime: SLOT.end }),
    (err: unknown) => err instanceof BookingEngineError && err.code === "LOCK_BUSY"
  );
});

test("isSlotAvailable игнорирует CANCELLED и протухшие PENDING-слоты", async () => {
  const { engine, storage } = makeEngine();

  storage.bookings.set("cancelled", makeBooking({ id: "cancelled", status: "CANCELLED" }));
  assert.equal(await engine.isSlotAvailable(SLOT.start, SLOT.end, "w1"), true);

  storage.bookings.set(
    "stale-pending",
    makeBooking({
      id: "stale-pending",
      status: "PENDING",
      createdAt: new Date(Date.now() - 16 * 60_000).toISOString(),
    })
  );
  assert.equal(await engine.isSlotAvailable(SLOT.start, SLOT.end, "w1"), true);

  storage.bookings.set(
    "fresh-pending",
    makeBooking({
      id: "fresh-pending",
      status: "PENDING",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    })
  );
  assert.equal(await engine.isSlotAvailable(SLOT.start, SLOT.end, "w1"), false);
});

// ---------------------------------------------------------------------------
// 2. Подтверждение брони и создание пользователя
// ---------------------------------------------------------------------------

test("confirmBooking подтверждает бронь и создаёт нового пользователя", async () => {
  const { engine, storage } = makeEngine();

  const booking = await engine.requestBooking({
    userEmail: "new@client.com",
    resourceId: "w1",
    name: "Иван",
    phone: "+79991234567",
    startTime: SLOT.start,
    endTime: SLOT.end,
    serviceData: { service: "стрижка" },
  });

  const confirmed = await engine.confirmBooking(booking.token);
  assert.equal(confirmed.status, "CONFIRMED");

  const user = await storage.findUserByEmail("new@client.com");
  assert.ok(user, "пользователь должен быть создан");
  assert.equal(user.name, "Иван");
  assert.equal(user.phone, "+79991234567");

  assert.ok(storage.logs.some((l) => l.action === "BOOKING_CONFIRMED"));
});

test("confirmBooking идемпотентен для уже подтверждённой брони", async () => {
  const { engine, storage } = makeEngine();

  const booking = await engine.requestBooking({
    userEmail: "e@f.g",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });
  await engine.confirmBooking(booking.token);
  const usersAfterFirst = storage.users.size;

  const again = await engine.confirmBooking(booking.token);
  assert.equal(again.id, booking.id);
  assert.equal(again.status, "CONFIRMED");
  assert.equal(storage.users.size, usersAfterFirst, "дубликат пользователя не создаётся");
});

test("confirmBooking отменяет протухшую PENDING-бронь и возвращает EXPIRED", async () => {
  const { engine, storage } = makeEngine();

  const booking = await engine.requestBooking({
    userEmail: "c@d.e",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });
  // имитируем, что с момента запроса прошло больше 15 минут
  storage.bookings.get(booking.id)!.createdAt = new Date(
    Date.now() - 16 * 60_000
  ).toISOString();

  await assert.rejects(
    engine.confirmBooking(booking.token),
    (err: unknown) => err instanceof BookingEngineError && err.code === "EXPIRED"
  );

  assert.equal(storage.bookings.get(booking.id)!.status, "CANCELLED");
  assert.equal(await engine.isSlotAvailable(SLOT.start, SLOT.end, "w1"), true, "слот освобождён");
});

test("confirmBooking возвращает INVALID_TOKEN для подделанного токена", async () => {
  const { engine } = makeEngine();
  const booking = await engine.requestBooking({
    userEmail: "a@b.c",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });

  const tampered = booking.token.slice(0, -1) + (booking.token.endsWith("a") ? "b" : "a");
  await assert.rejects(
    engine.confirmBooking(tampered),
    (err: unknown) => err instanceof BookingEngineError && err.code === "INVALID_TOKEN"
  );
});

// ---------------------------------------------------------------------------
// 3. Passwordless-аутентификация (Magic Links)
// ---------------------------------------------------------------------------

test("login-флоу: запрос ссылки, установка сессии и проверка cookie", async () => {
  const { engine, storage, emailProvider } = makeEngine();
  await storage.createUser({ email: "user@x.com", name: "User", phone: "0" });

  await engine.requestLogin("user@x.com");
  assert.equal(emailProvider.sent.length, 1);
  assert.match(emailProvider.sent[0].html, /\/api\/login\?token=/);

  const token = emailProvider.sent[0].html.match(/\/api\/login\?token=([^"<\s]+)/)?.[1];
  assert.ok(token, "токен должен быть в письме");

  const { email, sessionToken } = await engine.verifyLoginToken(token);
  assert.equal(email, "user@x.com");

  const session = engine.verifySession(sessionToken);
  assert.equal(session?.email, "user@x.com");

  assert.ok(storage.logs.some((l) => l.action === "LOGIN_SUCCESS"));
});

test("requestLogin не отправляет письмо для неизвестного email", async () => {
  const { engine, emailProvider } = makeEngine();
  await engine.requestLogin("ghost@x.com");
  assert.equal(emailProvider.sent.length, 0);
});

test("verifyLoginToken возвращает INVALID_TOKEN для недействительного токена", async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    engine.verifyLoginToken("not.a.valid-token"),
    (err: unknown) => err instanceof BookingEngineError && err.code === "INVALID_TOKEN"
  );
});

// ---------------------------------------------------------------------------
// 4. Защита от Double Booking (гонка запросов)
// ---------------------------------------------------------------------------

test("гонка: два одновременных requestBooking на один слот — выигрывает только один", async () => {
  const storage = new InMemoryStorage();
  storage.delayMs = 60; // расширяем окно гонки
  const emailProvider = new MockEmailProvider();
  const engine = new BookingEngine({
    storage,
    emailProvider,
    jwtSecret: "s",
    baseUrl: "http://x",
    lockProvider: new MemoryLockAdapter(),
  });

  const input = {
    userEmail: "race@x.com",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
    serviceData: {},
  };

  const results = await Promise.allSettled([
    engine.requestBooking(input),
    engine.requestBooking(input),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "ровно один запрос должен выиграть");
  assert.equal(rejected.length, 1, "ровно один запрос должен быть отклонён");

  const err = (rejected[0] as PromiseRejectedResult).reason as BookingEngineError;
  assert.ok(
    err.code === "LOCK_BUSY" || err.code === "SLOT_TAKEN",
    `ожидался LOCK_BUSY или SLOT_TAKEN, получен ${err.code}`
  );
  assert.equal(storage.bookings.size, 1, "создана ровно одна бронь");
});

// ---------------------------------------------------------------------------
// 5. Отмена и перенос из личного кабинета
// ---------------------------------------------------------------------------

test("cancelBooking запрещает отмену чужой брони (FORBIDDEN)", async () => {
  const { engine, storage } = makeEngine();
  const booking = await engine.requestBooking({
    userEmail: "owner@x.com",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });

  await assert.rejects(
    engine.cancelBooking(booking.id, "other@x.com"),
    (err: unknown) => err instanceof BookingEngineError && err.code === "FORBIDDEN"
  );
  assert.equal(storage.bookings.get(booking.id)!.status, "PENDING", "бронь не отменена");
});

test("rescheduleBooking запрещает перенос чужой брони (FORBIDDEN)", async () => {
  const { engine } = makeEngine();
  const booking = await engine.requestBooking({
    userEmail: "owner@x.com",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });

  await assert.rejects(
    engine.rescheduleBooking(booking.id, "other@x.com", SLOT.start, SLOT.end),
    (err: unknown) => err instanceof BookingEngineError && err.code === "FORBIDDEN"
  );
});

test("rescheduleBooking переносит бронь, игнорируя собственный старый слот", async () => {
  const { engine, storage } = makeEngine();
  const booking = await engine.requestBooking({
    userEmail: "owner@x.com",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });
  await engine.confirmBooking(booking.token);

  // новый интервал пересекается со старым — без исключения самого себя движок
  // ошибочно вернул бы SLOT_TAKEN
  const newStart = "2026-10-01T10:30:00.000Z";
  const newEnd = "2026-10-01T11:30:00.000Z";

  const updated = await engine.rescheduleBooking(booking.id, "owner@x.com", newStart, newEnd);
  assert.equal(updated.startTime, newStart);
  assert.equal(updated.endTime, newEnd);
  assert.equal(storage.bookings.get(booking.id)!.startTime, newStart);
  assert.ok(storage.logs.some((l) => l.action === "BOOKING_RESCHEDULED"));
});

test("rescheduleBooking отклоняет SLOT_TAKEN, если новое время занято другой бронью", async () => {
  const { engine, storage } = makeEngine();
  const booking = await engine.requestBooking({
    userEmail: "owner@x.com",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });
  await engine.confirmBooking(booking.token);

  storage.bookings.set(
    "other",
    makeBooking({
      id: "other",
      userEmail: "other@x.com",
      startTime: "2026-10-01T13:00:00.000Z",
      endTime: "2026-10-01T14:00:00.000Z",
    })
  );

  await assert.rejects(
    engine.rescheduleBooking(
      booking.id,
      "owner@x.com",
      "2026-10-01T13:00:00.000Z",
      "2026-10-01T14:00:00.000Z"
    ),
    (err: unknown) => err instanceof BookingEngineError && err.code === "SLOT_TAKEN"
  );
});

// ---------------------------------------------------------------------------
// 6. Атомарное резервирование (reserveSlot)
// ---------------------------------------------------------------------------

class AtomicStorage extends InMemoryStorage {
  reserveCalls = 0;

  async reserveSlot(input: ReserveSlotInput): Promise<ReserveSlotResult> {
    this.reserveCalls++;
    const overlapping = await this.findBookingsInRange(input.startTime, input.endTime);
    const staleBefore = input.staleBefore;
    const resourceId = input.resourceId;

    const blocked = overlapping.some((b) => {
      if (b.resourceId !== resourceId) return false;
      if (b.status === "CANCELLED") return false;
      if (b.status === "PENDING" && b.createdAt < staleBefore) return false;
      return true; // findBookingsInRange уже отфильтровал по пересечению
    });

    if (blocked) {
      return { reserved: false, reason: "SLOT_TAKEN" };
    }

    const booking = await this.createBooking({
      id: input.id,
      userEmail: input.userEmail,
      resourceId,
      startTime: input.startTime,
      endTime: input.endTime,
      serviceData: input.serviceData,
      status: "PENDING",
      token: input.token,
    });

    return { reserved: true, booking };
  }
}

test("requestBooking использует reserveSlot (атомарная запись за один вызов)", async () => {
  const storage = new AtomicStorage();
  const emailProvider = new MockEmailProvider();
  const engine = new BookingEngine({
    storage,
    emailProvider,
    jwtSecret: "s",
    baseUrl: "http://x",
  });

  const booking = await engine.requestBooking({
    userEmail: "a@b.c",
    resourceId: "w1",
    startTime: SLOT.start,
    endTime: SLOT.end,
  });

  assert.equal(booking.status, "PENDING");
  assert.equal(storage.reserveCalls, 1, "reserveSlot должен быть вызван один раз");
  assert.equal(storage.bookings.size, 1);
});

test("requestBooking через reserveSlot отклоняет занятый слот (SLOT_TAKEN)", async () => {
  const storage = new AtomicStorage();
  storage.bookings.set("existing", makeBooking({ id: "existing" })); // CONFIRMED

  const engine = new BookingEngine({
    storage,
    emailProvider: new MockEmailProvider(),
    jwtSecret: "s",
    baseUrl: "http://x",
  });

  await assert.rejects(
    engine.requestBooking({ userEmail: "a@b.c", resourceId: "w1", startTime: SLOT.start, endTime: SLOT.end }),
    (err: unknown) => err instanceof BookingEngineError && err.code === "SLOT_TAKEN"
  );
  assert.equal(storage.bookings.size, 1, "новая бронь не должна создаваться");
});

// ---------------------------------------------------------------------------
// 7. Работники (resources) и календарь занятости
// ---------------------------------------------------------------------------

test("createResource и listResources управляют списком работников", async () => {
  const { engine } = makeEngine();

  await engine.createResource({ name: "Анна" });
  await engine.createResource({ name: "Борис" });

  const list = await engine.listResources();
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((r) => r.name).sort(),
    ["Анна", "Борис"]
  );
});

test("getAvailability показывает свободных работников по слотам", async () => {
  const { engine, storage } = makeEngine();
  const anna = await engine.createResource({ name: "Анна" });
  const bob = await engine.createResource({ name: "Борис" });

  // Анна занята с 10:00 до 11:00
  storage.bookings.set(
    "anna-booked",
    makeBooking({ id: "anna-booked", resourceId: anna.id, userEmail: "u@x" })
  );

  const { resources, slots } = await engine.getAvailability(
    "2026-10-01T09:30:00.000Z",
    "2026-10-01T11:30:00.000Z",
    30
  );

  assert.equal(resources.length, 2);

  const slot10 = slots.find((s) => s.startTime === "2026-10-01T10:00:00.000Z");
  assert.ok(slot10, "слот 10:00 должен существовать");
  assert.deepEqual(slot10!.freeResourceIds, [bob.id], "в 10:00 свободен только Борис");

  const slot9 = slots.find((s) => s.startTime === "2026-10-01T09:30:00.000Z");
  assert.ok(slot9, "слот 09:30 должен существовать");
  assert.equal(slot9!.freeResourceIds.length, 2, "в 09:30 свободны оба мастера");
});
