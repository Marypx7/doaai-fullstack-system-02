import { Mongo } from '../database/mongo.js';
import { CATEGORIES_COLLECTION } from '../models/Category.js';
import { ObjectId } from 'mongodb';

export default class CategoryDataAccess {
  get collection() {
    return Mongo.db.collection(CATEGORIES_COLLECTION);
  }

  list(includeInactive = false) {
    const filter = includeInactive ? {} : { active: true };
    return this.collection.find(filter).sort({ name: 1 }).toArray();
  }

  async create(category) {
    const result = await this.collection.insertOne(category);
    return { ...category, _id: result.insertedId };
  }

  findBySlug(slug) {
    return this.collection.findOne({ slug, active: true });
  }

  findActiveById(id) {
    return this.collection.findOne({ _id: new ObjectId(id), active: true });
  }

  findActiveByIdOrSlug(value) {
    const filter = /^[a-f\d]{24}$/i.test(value)
      ? { _id: new ObjectId(value), active: true }
      : { slug: value, active: true };
    return this.collection.findOne(filter);
  }

  async update(id, updates) {
    return this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  async updateStatus(id, active) {
    return this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { active, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  async deactivate(id) {
    return this.updateStatus(id, false);
  }
}
