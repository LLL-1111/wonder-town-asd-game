import type { ActorRole } from '../types';

export type HelperRole = Exclude<ActorRole, 'system'>;

export type ProductAuthorization = HelperRole | null;

export function authorizeProductRole(role: HelperRole): ProductAuthorization {
  return role;
}

export function consumeProductAuthorization(_authorization: ProductAuthorization): ProductAuthorization {
  return null;
}

export interface Proposal {
  role: HelperRole;
  productId: string;
  atMs: number;
}

export type ConfirmationResult =
  | { kind: 'completed'; responseMs: number }
  | { kind: 'mismatch'; responseMs: number }
  | { kind: 'not-outstanding' };

export function otherHelperRole(role: HelperRole): HelperRole {
  return role === 'child' ? 'parent' : 'child';
}

export function classifyHelperConfirmation(
  proposal: Proposal,
  confirmer: HelperRole,
  productId: string,
  outstandingIds: string[],
  atMs: number,
): ConfirmationResult {
  if (confirmer === proposal.role) return { kind: 'not-outstanding' };
  if (!outstandingIds.includes(proposal.productId)) return { kind: 'not-outstanding' };
  const responseMs = Math.max(0, atMs - proposal.atMs);
  return productId === proposal.productId ? { kind: 'completed', responseMs } : { kind: 'mismatch', responseMs };
}

export function nextInitiatorFromCompletedCount(completedCount: number): HelperRole {
  return completedCount % 2 === 0 ? 'child' : 'parent';
}
