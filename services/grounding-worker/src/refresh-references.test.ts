import { describe, expect, it, vi } from 'vitest';
import type { ReferenceProduct, ReferenceValidationProduct } from '@wsgs/grounding-graph';
import { refreshStaleReferences } from './refresh-references.js';
const key = { namespace: 'gowm' as const, kind: 'WORLD_OBJECT', id: 'vehicle', version: '1' };
const product: ReferenceProduct = { productId: 'p', productKind: 'RESOLVED_REFERENCE', referenceKey: key, referenceType: 'VEHICLE', displayName: 'vehicle', matchedBy: 'EXACT', matchScore: 1, sourceOperation: 'reference.resolve', sourceWorldVersion: 0, revalidationRequired: true, safeSummary: {} };
const validation = (status: ReferenceValidationProduct['status'], referenceKey = key): ReferenceValidationProduct => ({ referenceKey, status, revalidationRequired: status !== 'VALID', warnings: [] });
describe('live reference refresh', () => {
  it('uses the authoritative new version and preserves the original', async () => {
    const current = { ...key, version: '2' };
    const result = await refreshStaleReferences({ products: [product], validations: [validation('STALE')], resolve: async () => current, validate: async k => validation('VALID', k) });
    expect(result.products[0]?.referenceKey).toEqual(current);
    expect(result.refreshes).toEqual([{ original: key, resolved: current }]);
    expect(result.validations[0]?.status).toBe('VALID');
    expect(product.referenceKey).toEqual(key);
  });
  it.each(['SCOPE_DENIED', 'NOT_FOUND', 'EXPIRED'] as const)('does not refresh %s', async status => {
    const resolve = vi.fn();
    const result = await refreshStaleReferences({ products: [product], validations: [validation(status)], resolve, validate: vi.fn() });
    expect(resolve).not.toHaveBeenCalled();
    expect(result.validations[0]?.status).toBe(status);
  });
  it('bounds racing snapshot retries and leaves persistent staleness unusable', async () => {
    const resolve = vi.fn(async () => key);
    const result = await refreshStaleReferences({ products: [product], validations: [validation('STALE')], resolve, validate: async k => validation('STALE', k) });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.validations[0]?.revalidationRequired).toBe(true);
  });
  it('rejects identity substitution', async () => {
    await expect(refreshStaleReferences({ products: [product], validations: [validation('STALE')], resolve: async () => ({ ...key, id: 'other' }), validate: vi.fn() })).rejects.toThrow('REFERENCE_REFRESH_IDENTITY_MISMATCH');
  });
});
