import { z } from 'zod';
import { badRequest } from './errors';

z.config(z.locales.de());

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${where}${issue.message}`);
  }
  return result.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const optionalEventQuery = z.object({ eventId: z.coerce.number().int().positive().optional() });
export const pin = z.string().regex(/^\d{4,8}$/, 'PIN muss aus 4 bis 8 Ziffern bestehen');
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe im Format #RRGGBB');
export const cents = z.number().int().min(0).max(1_000_000);

export { z };
