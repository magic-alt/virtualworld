import type { z } from 'zod';
import { HttpError } from './store';

/** Only the supplied incoming value is a client error; never wrap asynchronous work. */
export function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  return result.data;
}
