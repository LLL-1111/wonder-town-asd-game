import { describe, expect, it } from 'vitest';
import { authorizeProductRole, classifyHelperConfirmation, consumeProductAuthorization, nextInitiatorFromCompletedCount } from './shoppingHelper';

describe('shopping helper collaboration scoring', () => {
  it('requires role authorization and consumes it after one product operation', () => {
    expect(consumeProductAuthorization(null)).toBeNull();
    expect(consumeProductAuthorization(authorizeProductRole('parent'))).toBeNull();
    expect(consumeProductAuthorization(authorizeProductRole('child'))).toBeNull();
  });

  it('allows either role to authorize consecutive product operations', () => {
    expect([authorizeProductRole('parent'), authorizeProductRole('parent'), authorizeProductRole('child')])
      .toEqual(['parent', 'parent', 'child']);
  });

  it('accepts the other participant confirming the proposed outstanding item', () => {
    expect(classifyHelperConfirmation({ role: 'child', productId: 'F01', atMs: 1000 }, 'parent', 'F01', ['F01'], 3600))
      .toEqual({ kind: 'completed', responseMs: 2600 });
  });

  it('records a mismatch without treating it as a shared confirmation', () => {
    expect(classifyHelperConfirmation({ role: 'parent', productId: 'D01', atMs: 1000 }, 'child', 'F01', ['D01'], 2100))
      .toEqual({ kind: 'mismatch', responseMs: 1100 });
  });

  it('alternates the planned first indicator between child and parent', () => {
    expect(nextInitiatorFromCompletedCount(0)).toBe('child');
    expect(nextInitiatorFromCompletedCount(1)).toBe('parent');
  });
});
