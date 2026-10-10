CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`collected_at` text NOT NULL,
	`payload` text NOT NULL
);
