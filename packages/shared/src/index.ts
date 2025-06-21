import { z } from 'zod';

// Placeholder schema so the package compiles. M1 replaces this with real auth schemas.
export const PlaceholderSchema = z.object({ ok: z.boolean() });
export type Placeholder = z.infer<typeof PlaceholderSchema>;
