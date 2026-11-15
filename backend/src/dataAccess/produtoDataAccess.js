import { ObjectId } from 'mongodb';
import { Mongo } from '../database/mongo.js';
import { PRODUCTS_COLLECTION } from '../models/produtos.js';
import { escapeRegex } from '../helpers/validation.js';

export const PUBLIC_PRODUCT_PROJECTION = {
  _id: 1,
  name: 1,
  description: 1,
  categoryId: 1,
  subcategory: 1,
  condition: 1,
  photos: 1,
  neighborhood: 1,
  status: 1,
  createdAt: 1
};

function toPublicProduct(product) {
  return {
    _id: product._id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    subcategory: product.subcategory,
    condition: product.condition,
    photos: Array.isArray(product.photos)
      ? product.photos
        .map((photo) => typeof photo === 'string'
          ? photo
          : photo && typeof photo.url === 'string' ? { url: photo.url } : null)
        .filter(Boolean)
      : [],
    neighborhood: product.neighborhood,
    status: product.status,
    createdAt: product.createdAt
  };
}

export default class ProductDataAccess {
  static publicVisibilityFilter() {
    return {
      hidden: { $ne: true },
      visible: { $ne: false },
      visibility: { $nin: ['hidden', 'private'] },
      deletedAt: { $exists: false },
      moderationStatus: { $nin: ['hidden', 'removed', 'deleted'] }
    };
  }

  get collection() {
    return Mongo.db.collection(PRODUCTS_COLLECTION);
  }

  async list({ ownerId, categoryId, subcategory, condition, neighborhood, status, search, page, limit, sort }) {
    const filter = {};
    if (ownerId) filter.ownerId = new ObjectId(ownerId);
    if (categoryId) filter.categoryId = new ObjectId(categoryId);
    if (subcategory) filter.subcategory = new RegExp(`^${escapeRegex(subcategory)}$`, 'i');
    if (condition) filter.condition = new RegExp(`^${escapeRegex(condition)}$`, 'i');
    if (neighborhood) filter.neighborhood = new RegExp(escapeRegex(neighborhood), 'i');
    if (status) filter.status = status;
    if (search) {
      filter.$text = { $search: search };
    }
    if (!ownerId) {
      Object.assign(filter, ProductDataAccess.publicVisibilityFilter());
    }

    const sortOrder = sort === 'oldest' ? 1 : -1;

    const isPublic = !ownerId;
    const [items, total] = await Promise.all([
      this.collection.find(filter, isPublic ? { projection: PUBLIC_PRODUCT_PROJECTION } : undefined)
        .sort({ createdAt: sortOrder, _id: sortOrder }).skip((page - 1) * limit).limit(limit).toArray(),
      this.collection.countDocuments(filter)
    ]);
    return {
      items: isPublic ? items.map(toPublicProduct) : items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1
    };
  }

  async countByOwnerStatus(ownerId) {
    const counts = {
      total: 0,
      disponivel: 0,
      reservado: 0,
      doado: 0
    };
    const statusCounts = await this.collection.aggregate([
      { $match: { ownerId: new ObjectId(ownerId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();

    for (const { _id, count } of statusCounts) {
      counts.total += count;
      if (Object.hasOwn(counts, _id)) counts[_id] = count;
    }

    return counts;
  }

  findById(id) {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findPublicById(id) {
    const product = await this.collection.findOne({
      _id: new ObjectId(id),
      ...ProductDataAccess.publicVisibilityFilter()
    }, { projection: PUBLIC_PRODUCT_PROJECTION });
    return product ? toPublicProduct(product) : null;
  }

  async create(product) {
    const result = await this.collection.insertOne(product);
    return { ...product, _id: result.insertedId };
  }

  async update(id, ownerId, updates) {
    return this.collection.findOneAndUpdate(
      { _id: new ObjectId(id), ownerId: new ObjectId(ownerId) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  async restorePhotos(id, ownerId, photos) {
    if (!photos.length) return;
    await this.collection.updateOne(
      { _id: new ObjectId(id), ownerId: new ObjectId(ownerId) },
      {
        $addToSet: { photos: { $each: photos } },
        $set: { updatedAt: new Date() }
      }
    );
  }

  async delete(id, ownerId) {
    return this.collection.deleteOne({ _id: new ObjectId(id), ownerId: new ObjectId(ownerId) });
  }
}