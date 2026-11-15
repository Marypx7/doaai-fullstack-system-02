export const FAVORITES_COLLECTION = 'favorites';

export function createFavoriteDocument({ userId, productId }) {
  return { userId, productId, createdAt: new Date() };
}
