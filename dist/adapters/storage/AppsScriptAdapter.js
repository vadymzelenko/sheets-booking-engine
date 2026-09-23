"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppsScriptAdapter = void 0;
class AppsScriptAdapter {
    constructor(config) {
        this.webAppUrl = config.webAppUrl.replace(/\/+$/, "");
        this.secret = config.secret;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }
    async call(action, params = {}) {
        let res;
        try {
            res = await this.fetchImpl(this.webAppUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ secret: this.secret, action, params }),
            });
        }
        catch (err) {
            throw new Error(`AppsScriptAdapter: network error — ${err.message}`);
        }
        if (!res.ok) {
            throw new Error(`AppsScriptAdapter: HTTP ${res.status}`);
        }
        const json = (await res.json());
        if (typeof json.ok !== "boolean") {
            throw new Error("AppsScriptAdapter: неожиданный формат ответа от Apps Script (нет поля 'ok'). " +
                "Убедитесь, что развёрнут apps-script/Code.gs из репозитория, а не произвольный doPost.");
        }
        if (!json.ok) {
            throw new Error(`AppsScriptAdapter: ${json.error ?? "unknown error"}`);
        }
        return json.data;
    }
    /** Проверка соединения с Apps Script (не входит в IBookingStorage). */
    async ping() {
        const data = await this.call("ping");
        return data?.pong === true;
    }
    async findUserByEmail(email) {
        return this.call("findUserByEmail", { email });
    }
    async createUser(input) {
        return this.call("createUser", { ...input });
    }
    async listResources() {
        return this.call("listResources");
    }
    async createResource(input) {
        return this.call("createResource", { ...input });
    }
    async deleteResource(id) {
        await this.call("deleteResource", { id });
    }
    async findBookingById(id) {
        return this.call("findBookingById", { id });
    }
    async findBookingsInRange(startTime, endTime) {
        return this.call("findBookingsInRange", { startTime, endTime });
    }
    async createBooking(record) {
        return this.call("createBooking", { ...record });
    }
    /** Атомарная проверка + запись слота за один round-trip к Apps Script. */
    async reserveSlot(input) {
        return this.call("reserveSlot", { ...input });
    }
    async updateBookingStatus(id, status) {
        await this.call("updateBookingStatus", { id, status });
    }
    async updateBookingTime(id, startTime, endTime) {
        await this.call("updateBookingTime", { id, startTime, endTime });
    }
    async listBookingsByUser(email) {
        return this.call("listBookingsByUser", { email });
    }
    async listBookings() {
        return this.call("listBookings");
    }
    async deleteBooking(id) {
        await this.call("deleteBooking", { id });
    }
    async listUsers() {
        return this.call("listUsers");
    }
    async appendLog(log) {
        await this.call("appendLog", { ...log });
    }
    async listLogs() {
        return this.call("listLogs");
    }
    /** Пересобрать человекочитаемый лист «Отчёт» в таблице. */
    async rebuildReport() {
        await this.call("rebuildReport");
    }
    /** Динамически добавляет кастомную колонку в лист. */
    async ensureCustomColumn(sheet, columnName) {
        await this.call("ensureCustomColumn", { sheet, columnName });
    }
}
exports.AppsScriptAdapter = AppsScriptAdapter;
