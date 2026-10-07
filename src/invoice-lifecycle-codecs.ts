import { z } from 'zod';
import { integerString } from './codecs.js';

// The count is kept as exact integer text, up to 30 digits, so no JSON number is ever
// narrowed to a double on the way through.
export const issuedCountSchema = z.object({ issued_count: integerString });
