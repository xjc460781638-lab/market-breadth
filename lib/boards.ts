import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().regex(/^\d{6}\.(TI|SH|SZ|CSI)$/);
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
    source: z.literal("ifind"),
    times: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/))
      .max(300),
    boards: z
      .array(
        z.object({
          code,
          name: z.string().max(50),
          provider: z.literal("ifind"),
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
export const boardReportSchema = flowReportSchema;
export const boardKindSchema = z.enum([
  "flow-concept",
  "flow-industry",
  "flow-index",
]);
export type FlowReport = z.infer<typeof flowReportSchema>;
