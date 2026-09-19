import './setup-env.js';
import { describe, it, expect } from 'vitest';
import { isDatabaseUnavailable } from '../lib/api.js';

/**
 * A database outage must be reported as a database outage.
 *
 * Almost every route reads from the database immediately after authenticating,
 * so without this a connection failure surfaces as "unable to verify your
 * Shopify session" and sends people debugging the wrong system entirely.
 */

const prismaError = (code) => Object.assign(new Error('connection problem'), { code });

describe('isDatabaseUnavailable', () => {
  it('recognises an unreachable database server', () => {
    expect(isDatabaseUnavailable(prismaError('P1001'))).toBe(true);
  });

  it('recognises bad credentials', () => {
    expect(isDatabaseUnavailable(prismaError('P1000'))).toBe(true);
  });

  it('recognises a connection timeout', () => {
    expect(isDatabaseUnavailable(prismaError('P1002'))).toBe(true);
    expect(isDatabaseUnavailable(prismaError('P1008'))).toBe(true);
  });

  it('recognises a malformed connection string', () => {
    expect(isDatabaseUnavailable(prismaError('P1013'))).toBe(true);
  });

  it('recognises a client that could not initialise', () => {
    const error = new Error('could not connect');
    error.name = 'PrismaClientInitializationError';
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it('does not mistake a unique-constraint violation for an outage', () => {
    expect(isDatabaseUnavailable(prismaError('P2002'))).toBe(false);
  });

  it('does not mistake a missing record for an outage', () => {
    expect(isDatabaseUnavailable(prismaError('P2025'))).toBe(false);
  });

  it('ignores ordinary errors', () => {
    expect(isDatabaseUnavailable(new Error('something else'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});
