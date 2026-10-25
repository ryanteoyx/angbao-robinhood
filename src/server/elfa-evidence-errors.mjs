/** Shared error contract; deliberately has no SQLite/transport dependency. */
export class ElfaReservationError extends Error {
  constructor(code) { super('The evidence reservation could not be confirmed. No replacement read was started.'); this.name = 'ElfaReservationError'; this.code = code; }
  toJSON() { return { name: this.name, code: this.code, message: this.message }; }
}
