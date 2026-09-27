import { supabase } from './supabase';
import { parseAttributes, variantFields, type VariationDraft } from './productVariations';

// One database transaction preserves the parent, variants and warehouse initialization together.
// Variant IDs remain ordinary product IDs for existing stock, audit and financial consumers.
export async function saveProductVariations(parent: Record<string, unknown> & { id: string }, draft: VariationDraft, uploadImage: (file: File) => Promise<string>) {
  const variants = await Promise.all(draft.variants.map(async v => ({
    id: v.id, parentProductId: parent.id, hasVariations: false, variationAttributes: [],
    variantValues: v.values, variantEnabled: draft.enabled && v.enabled,
    sku: v.sku.trim(), name: `${parent.name} — ${Object.values(v.values).join(' / ')}`,
    category: parent.category, supplier: parent.supplier,
    photoUrl: v.imageFile ? await uploadImage(v.imageFile) : v.photoUrl ?? parent.photoUrl,
    ...Object.fromEntries(variantFields.map(([key]) => [key, key === 'promoPrice' && v[key] === '' ? null : Number(v[key])])),
    wholesalePrice: Number(v.mmPrice), dealerPrice: Number(v.provincialPrice),
    updatedAt: new Date().toISOString(),
  })));
  const { error } = await supabase.rpc('save_product_variations', {
    parent_data: { ...parent, hasVariations: draft.enabled, variationAttributes: draft.enabled ? parseAttributes(draft) : [] },
    variant_data: variants,
  });
  if (error) throw new Error(['PGRST202', '42703', '42883'].includes(error.code)
    ? 'Product variations are not configured in this database yet. Apply the product variations migration, then try again.' : error.message);
}
