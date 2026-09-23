// src/index.ts — публичный API пакета

export { BookingEngine, BookingEngineError } from "./core/BookingEngine";

export type {
  IBookingStorage,
  IEmailProvider,
  ILockProvider,
  BookingEngineConfig,
  UserRecord,
  ResourceRecord,
  BookingRecord,
  LogRecord,
  BookingStatus,
  CreateUserInput,
  CreateResourceInput,
  CreateBookingInput,
  ReserveSlotInput,
  ReserveSlotResult,
  AvailabilitySlot,
} from "./types";

export { AppsScriptAdapter } from "./adapters/storage/AppsScriptAdapter";
export type { AppsScriptAdapterConfig } from "./adapters/storage/AppsScriptAdapter";

export { MemoryLockAdapter } from "./adapters/lock/MemoryLockAdapter";

export { ResendAdapter } from "./adapters/email/ResendAdapter";
export type { ResendAdapterConfig } from "./adapters/email/ResendAdapter";

export { NodemailerAdapter } from "./adapters/email/NodemailerAdapter";
export type { NodemailerAdapterConfig } from "./adapters/email/NodemailerAdapter";
