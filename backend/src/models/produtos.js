export const PRODUCTS_COLLECTION = 'products';
export const DONATION_STATUSES = ['disponivel', 'reservado', 'doado'];

export function createProductDocument({ ownerId, name, description, categoryId, subcategory, condition, photos, neighborhood }) {
  const now = new Date();
  return {
    ownerId,
    name,
    description,
    categoryId,
    subcategory,
    condition,
    photos,
    neighborhood,
    status: 'disponivel',
    createdAt: now,
    updatedAt: now
  };
}