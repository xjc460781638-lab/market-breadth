CREATE TABLE `collector_state` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`message` text NOT NULL,
	`lease` text
);
