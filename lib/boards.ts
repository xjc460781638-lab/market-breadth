import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().regex(/^(90\.BK\d+|[012]\.\d{6}|BK\d+)$/);
const common = {
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{24}$/),
  collectedAt: z.string().datetime({ offset: true }),
  asOf: z.string().max(30),
  calendar: z.array(date).max(1500),
};
export const flowReportSchema = z
  .object({
    ...common,
    kind: z.enum(["flow-concept", "flow-industry", "flow-index"]),
    resolution: z.enum(["minute", "close"]).optional(),
    times: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/))
      .max(300),
    boards: z
      .array(
        z.object({
          code,
          name: z.string().max(50),
          asOf: z.string().max(30).nullable(),
          net: z.number().finite().nullable(),
          values: z.array(z.number().finite().nullable()).max(300),
          error: z.string().max(160).nullable(),
        }),
      )
      .max(1500),
  })
  .strict()
  .refine(
    (r) => r.boards.every((b) => b.values.length === r.times.length),
    "Curve alignment mismatch",
  );
export const conceptReportSchema = z
  .object({
    ...common,
    kind: z.literal("concept-breadth"),
    dates: z.array(date).length(250),
    market: z.array(z.number().int().min(0).max(100)).length(250),
    boards: z
      .array(
        z.object({
          code,
          name: z.string().max(50),
          membershipDate: date,
          eligible: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          values: z
            .array(z.number().int().min(0).max(100).nullable())
            .length(250),
        }),
      )
      .min(1)
      .max(1500),
  })
  .strict();
export const boardReportSchema = z.union([
  flowReportSchema,
  conceptReportSchema,
]);
export const boardKindSchema = z.enum([
  "flow-concept",
  "flow-industry",
  "flow-index",
  "concept-breadth",
]);
export type FlowReport = z.infer<typeof flowReportSchema>;
export type ConceptReport = z.infer<typeof conceptReportSchema>;
