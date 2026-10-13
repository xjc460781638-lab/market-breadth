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
export const refreshJobs=sqliteTable('refresh_jobs',{
  id:text('id').primaryKey(),scope:text('scope').notNull(),request:text('request').notNull(),
  status:text('status').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
  message:text('message').notNull(),lease:text('lease'),
});
export const collectorState=sqliteTable('collector_state',{
  id:text('id').primaryKey(),heartbeat:text('heartbeat').notNull(),
});
