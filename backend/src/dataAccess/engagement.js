import { ObjectId } from 'mongodb';
import { Mongo } from '../database/mongo.js';
import { FAVORITES_COLLECTION } from '../models/Favorite.js';
import { REPORTS_COLLECTION } from '../models/Report.js';
import ProductDataAccess, { PUBLIC_PRODUCT_PROJECTION } from './produtoDataAccess.js';

const PUBLIC_FAVORITE_PRODUCT_PROJECTION = {
  ...PUBLIC_PRODUCT_PROJECTION,
  photos: {
    $map: {
      input: { $ifNull: ['$photos', []] },
      as: 'photo',
      in: {
        $cond: [
          { $eq: [{ $type: '$$photo' }, 'object'] },
          { url: '$$photo.url' },
          '$$photo'
        ]
      }
    }
  },
};

export default class EngagementDataAccess {
  get favorites() {
    return Mongo.db.collection(FAVORITES_COLLECTION);
  }

  get reports() {
    return Mongo.db.collection(REPORTS_COLLECTION);
  }

  listFavorites(userId) {
    return this.favorites.aggregate([
      { $match: { userId: new ObjectId(userId) } },
      {
        $lookup: {
          from: 'products',
          let: { favoriteProductId: '$productId' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$_id', '$$favoriteProductId'] },
                ...ProductDataAccess.publicVisibilityFilter()
              }
            },
            { $project: PUBLIC_FAVORITE_PRODUCT_PROJECTION }
          ],
          as: 'product'
        }
      },
      { $unwind: '$product' },
      { $project: { _id: 0, productId: 1, createdAt: 1, product: 1 } },
      { $sort: { createdAt: -1 } }
    ]).toArray();
  }

  async addFavorite(userId, productId) {
    const result = await this.favorites.insertOne({
      userId: new ObjectId(userId),
      productId: new ObjectId(productId),
      createdAt: new Date()
    });
    return result.insertedId;
  }

  async removeFavorite(userId, productId) {
    const result = await this.favorites.deleteOne({
      userId: new ObjectId(userId),
      productId: new ObjectId(productId)
    });
    return result.deletedCount;
  }

  async createReport(report) {
    const result = await this.reports.insertOne(report);
    return { ...report, _id: result.insertedId };
  }

  findReportByDedupeKey(dedupeKey) {
    return this.reports.findOne({ dedupeKey });
  }

  countReportsSince(reporterId, since) {
    return this.reports.countDocuments({
      reporterId: new ObjectId(reporterId),
      createdAt: { $gte: since }
    });
  }

  claimFailedReport(id) {
    return this.reports.updateOne(
      { _id: id, emailStatus: 'failed' },
      { $set: { emailStatus: 'sending' } }
    );
  }

  updateReportEmailStatus(id, emailStatus) {
    return this.reports.updateOne({ _id: id }, { $set: { emailStatus } });
  }

  listReports(userId) {
    return this.reports.find({ reporterId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray();
  }

  listAllReports() {
    return this.reports
      .find({}, { projection: { dedupeKey: 0, emailStatus: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async updateReportStatus(id, status) {
    const result = await this.reports.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { dedupeKey: 0, emailStatus: 0 } }
    );
    return result;
  }
}
