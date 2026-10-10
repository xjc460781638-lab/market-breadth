// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  revision: text('revision').notNull(),
  collectedAt: text('collected_at').notNull(),
  payload: text('payload').notNull(),
});
