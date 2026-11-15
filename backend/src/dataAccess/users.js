import { Mongo } from '../database/mongo.js';
import { ObjectId } from 'mongodb';
import { USERS_COLLECTION } from '../models/User.js';
import { hashPassword } from '../auth/password.js';
import { publicUser } from '../helpers/validation.js';

const collectionName = USERS_COLLECTION;

export default class UserDataAccess {
  async findUserById(userId) {
    const user = await Mongo.db
      .collection(collectionName)
      .findOne(
        { _id: new ObjectId(userId) }
      );
    if (!user) return null;
    return {
      ...publicUser(user),
      connectedProviders: Object.keys(user.socialAccounts || {})
        .filter((provider) => ['google', 'facebook', 'microsoft'].includes(provider))
    };
  }

  async getUsers() {
    const result = await Mongo.db
    .collection(collectionName)
    .find({}, { projection: { _id: 1, name: 1, neighborhood: 1, createdAt: 1 } })
    .toArray();

    return result;

  }
 
  async deleteUser(userId) {
    const result = await Mongo.db
    .collection(collectionName)
    .deleteOne({ _id: new ObjectId(userId) });

    return result.deletedCount;
  }

  async updateUser(userId, userData) {
    const updates = {};

    if (userData.email !== undefined) {
      updates.email = userData.email;
    }

    if (userData.password !== undefined) {
      Object.assign(updates, await hashPassword(userData.password));
    }
    if (userData.name !== undefined) updates.name = userData.name;
    if (userData.neighborhood !== undefined) updates.neighborhood = userData.neighborhood;
    updates.updatedAt = new Date();

    const result = await Mongo.db
      .collection(collectionName)
      .updateOne(
        { _id: new ObjectId(userId) },
        { $set: updates }
      );

    return result.matchedCount;
  }
}