import { z } from 'zod';
export const scoreSchema = z.object({
  unitId: z.string().max(200),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});
export const pageCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EXTRACT'), granularity: z.enum(['sentence', 'paragraph']) }),
  z.object({
    type: z.literal('PAINT'),
    documentId: z.string(),
    items: z.array(scoreSchema).max(2400),
    navigator: z.boolean(),
  }),
  z.object({ type: z.literal('HOVER'), id: z.string().nullable() }),
  z.object({ type: z.literal('SELECT'), id: z.string() }),
  z.object({ type: z.literal('CLEAR') }),
  z.object({ type: z.literal('ACTIONS'), goal: z.string().max(500).optional() }),
  z.object({ type: z.literal('PROPOSE'), id: z.string() }),
  z.object({ type: z.literal('EXECUTE'), id: z.string(), approved: z.literal(true) }),
  z.object({ type: z.literal('STOP') }),
]);
export type PageCommand = z.infer<typeof pageCommandSchema>;
export const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PAGE_CHANGED') }),
  z.object({ type: z.literal('ACTIVE'), id: z.string(), documentId: z.string() }),
  z.object({ type: z.literal('ESCAPE') }),
]);
export type PageEvent = z.infer<typeof eventSchema>;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
