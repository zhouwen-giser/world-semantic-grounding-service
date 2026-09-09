import type { ReferenceProduct, ReferenceValidationProduct } from '@wsgs/grounding-graph';

type Key = ReferenceProduct['referenceKey'];
export function sameIdentity(a: Key, b: Key): boolean {
  return a.namespace === b.namespace && a.kind === b.kind && a.id === b.id;
}

/** Refresh only stale live identities; a failed authorization is never refreshable. */
export async function refreshStaleReferences(input: {
  products: readonly ReferenceProduct[];
  validations: readonly ReferenceValidationProduct[];
  resolve: (key: Key) => Promise<Key>;
  validate: (key: Key) => Promise<ReferenceValidationProduct>;
}): Promise<{ products: ReferenceProduct[]; validations: ReferenceValidationProduct[]; refreshes: Array<{ original: Key; resolved: Key }> }> {
  const products: ReferenceProduct[] = [], validations: ReferenceValidationProduct[] = [], refreshes: Array<{ original: Key; resolved: Key }> = [];
  for (const product of input.products) {
    let current = product;
    let validation = input.validations.find(v => sameIdentity(v.referenceKey, product.referenceKey) && v.referenceKey.version === product.referenceKey.version);
    if (!validation) throw new Error('REFERENCE_VALIDATION_MISSING');
    if (['WORLD_OBJECT', 'OPERATIONAL_TASK'].includes(product.referenceKey.kind)) {
      for (let attempt = 0; validation.status === 'STALE' && attempt < 2; attempt++) {
        const resolved = await input.resolve(current.referenceKey);
        if (!sameIdentity(resolved, product.referenceKey) || typeof resolved.version !== 'string' || !resolved.version) throw new Error('REFERENCE_REFRESH_IDENTITY_MISMATCH');
        const checked = await input.validate(resolved);
        if (!sameIdentity(checked.referenceKey, resolved) || checked.referenceKey.version !== resolved.version) throw new Error('REFERENCE_REFRESH_VALIDATION_MISMATCH');
        refreshes.push({ original: current.referenceKey, resolved });
        current = { ...current, referenceKey: resolved, safeSummary: { ...current.safeSummary, originalReferenceKey: product.referenceKey, refreshedReferenceKey: resolved } };
        validation = checked;
      }
    }
    products.push(current); validations.push(validation);
  }
  return { products, validations, refreshes };
}
