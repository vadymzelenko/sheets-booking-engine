// test/apps-script-adapter.test.ts
// Проверка AppsScriptAdapter (транспорт поверх HTTP) на моке fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AppsScriptAdapter } from "../src/index";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("AppsScriptAdapter.createBooking отправляет корректный payload и маппит ответ", async () => {
  const calls: { url: string; body: { secret: string; action: string; params: Record<string, unknown> } }[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(input), body });

    const params = body.params as Record<string, string>;
    return jsonResponse({
      ok: true,
      data: {
        id: "b1",
        userEmail: params.userEmail,
        resourceId: params.resourceId,
        startTime: params.startTime,
        endTime: params.endTime,
        serviceData: params.serviceData,
        status: params.status,
        token: params.token,
        createdAt: "2026-10-01T09:00:00.000Z",
      },
    });
  };

  const adapter = new AppsScriptAdapter({
    webAppUrl: "https://script.google.com/macros/s/abc/exec",
    secret: "topsecret",
    fetchImpl,
  });

  const record = await adapter.createBooking({
    userEmail: "a@b.c",
    resourceId: "w1",
    startTime: "2026-10-01T10:00:00.000Z",
    endTime: "2026-10-01T11:00:00.000Z",
    serviceData: "{}",
    status: "PENDING",
    token: "jwt",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://script.google.com/macros/s/abc/exec");
  assert.equal(calls[0].body.secret, "topsecret");
  assert.equal(calls[0].body.action, "createBooking");
  assert.equal(record.id, "b1");
  assert.equal(record.status, "PENDING");
  assert.equal(record.userEmail, "a@b.c");
});

test("AppsScriptAdapter возвращает данные findBookingsInRange", async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      ok: true,
      data: [
        {
          id: "x",
          userEmail: "u@x",
          resourceId: "w1",
          startTime: "2026-10-01T10:00:00.000Z",
          endTime: "2026-10-01T11:00:00.000Z",
          serviceData: "{}",
          status: "CONFIRMED",
          token: "t",
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });

  const adapter = new AppsScriptAdapter({
    webAppUrl: "https://script.google.com/macros/s/abc/exec",
    secret: "s",
    fetchImpl,
  });

  const list = await adapter.findBookingsInRange(
    "2026-10-01T09:00:00.000Z",
    "2026-10-01T12:00:00.000Z"
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "CONFIRMED");
});

test("AppsScriptAdapter бросает ошибку при { ok: false }", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ ok: false, error: "Unauthorized" });
  const adapter = new AppsScriptAdapter({
    webAppUrl: "https://script.google.com/macros/s/abc/exec",
    secret: "s",
    fetchImpl,
  });

  await assert.rejects(() => adapter.findBookingById("1"), /Unauthorized/);
});

test("AppsScriptAdapter.ping возвращает true", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ ok: true, data: { pong: true } });
  const adapter = new AppsScriptAdapter({
    webAppUrl: "https://script.google.com/macros/s/abc/exec",
    secret: "s",
    fetchImpl,
  });

  assert.equal(await adapter.ping(), true);
});

test("AppsScriptAdapter.reserveSlot передаёт payload и маппит ответ", async () => {
  const calls: { action: string; params: Record<string, unknown> }[] = [];

  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ action: body.action, params: body.params });
    const params = body.params as Record<string, string>;
    return jsonResponse({
      ok: true,
      data: {
        reserved: true,
        booking: {
          id: params.id,
          userEmail: params.userEmail,
          resourceId: params.resourceId,
          startTime: params.startTime,
          endTime: params.endTime,
          serviceData: params.serviceData,
          status: "PENDING",
          token: params.token,
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      },
    });
  };

  const adapter = new AppsScriptAdapter({
    webAppUrl: "https://script.google.com/macros/s/abc/exec",
    secret: "s",
    fetchImpl,
  });

  const result = await adapter.reserveSlot({
    id: "b1",
    userEmail: "a@b.c",
    resourceId: "w1",
    startTime: "2026-10-01T10:00:00.000Z",
    endTime: "2026-10-01T11:00:00.000Z",
    serviceData: "{}",
    token: "jwt",
    staleBefore: "2026-10-01T09:45:00.000Z",
  });

  assert.equal(calls[0]?.action, "reserveSlot");
  assert.equal(
    (calls[0]?.params as { staleBefore: string }).staleBefore,
    "2026-10-01T09:45:00.000Z"
  );
  assert.ok(result.reserved);
  if (result.reserved) {
    assert.equal(result.booking.id, "b1");
    assert.equal(result.booking.status, "PENDING");
  }
});
