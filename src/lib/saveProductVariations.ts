import { supabase } from './supabase';
import { parseAttributes, validateVariations, variantFields, type VariationDraft } from './productVariations';

// One database transaction preserves the parent, variants and warehouse initialization together.
// Variant IDs remain ordinary product IDs for existing stock, audit and financial consumers.
export async function saveProductVariations(parent: Record<string, unknown> & { id: string }, draft: VariationDraft, uploadImage: (file: File) => Promise<string>) {
  if (draft.enabled) {
    const validationError = validateVariations(draft, String(parent.sku ?? ''), [], parent.id);
    if (validationError) {
      throw new Error(validationError);
    }
  }
  const variants = await Promise.all(draft.variants.map(async v => ({
    id: v.id, parentProductId: parent.id, hasVariations: false, variationAttributes: [],
    variantValues: v.values, variantEnabled: draft.enabled && v.enabled,
    sku: v.sku.trim(), name: `${parent.name} — ${Object.values(v.values).join(' / ')}`,
    category: parent.category, supplier: parent.supplier, unit: String(parent.unit ?? '').trim() || String(parent.units ?? 'pc'), units: parent.units ?? 1,
    photoUrl: draft.enabled && v.imageFile ? await uploadImage(v.imageFile) : v.photoUrl ?? parent.photoUrl,
    ...Object.fromEntries(variantFields.map(([key]) => {
      const raw = String(v[key] ?? '').trim();
      return [key, key === 'promoPrice' && raw === '' ? null : Number(raw)];
    })),
    wholesalePrice: Number(String(v.mmPrice ?? '').trim()), dealerPrice: Number(String(v.provincialPrice ?? '').trim()),
    updatedAt: new Date().toISOString(),
  })));
  const { error } = await supabase.rpc('save_product_variations', {
    parent_data: { ...parent, hasVariations: draft.enabled, variationAttributes: draft.enabled ? parseAttributes(draft) : [] },
    variant_data: variants,
  });
  if (error) throw new Error(['PGRST202', '42703', '42883'].includes(error.code)
    ? 'Product variations are not configured in this database yet. Apply the product variations migration, then try again.' : error.message);
}
