import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, afterEach, test } from 'node:test';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';

process.env.JWT_SECRET = 'doaai-test-secret-with-at-least-thirty-two-characters';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const { ObjectId } = await import('mongodb');
const jwt = (await import('jsonwebtoken')).default;
const { verifyPassword } = await import('../src/auth/password.js');
const { Mongo } = await import('../src/database/mongo.js');
const { createApp } = await import('../src/app.js');

const ownerId = new ObjectId();
const anotherUserId = new ObjectId();
const categoryId = new ObjectId();

function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((condition) => matches(document, condition));
    if (key === '$and') return expected.every((condition) => matches(document, condition));
    if (key === '$text') {
      const text = `${document.name || ''} ${document.description || ''}`.toLowerCase();
      return text.includes(expected.$search.toLowerCase());
    }
    const actual = document[key];
    if (expected instanceof RegExp) return expected.test(actual || '');
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      if ('$ne' in expected && actual === expected.$ne) return false;
      if ('$nin' in expected && expected.$nin.includes(actual)) return false;
      if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false;
      if ('$gte' in expected && !(actual >= expected.$gte)) return false;
      if ('$gt' in expected && !(actual > expected.$gt)) return false;
      if ('$lte' in expected && !(actual <= expected.$lte)) return false;
      return true;
    }
    if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
    return actual === expected;
  });
}

function projectDocument(document, projection) {
  const includedFields = Object.entries(projection || {}).filter(([, value]) => value === 1);
  if (!includedFields.length) {
    const result = { ...document };
    for (const [field, value] of Object.entries(projection || {})) {
      if (value === 0) delete result[field];
    }
    return result;
  }

  const result = {};
  if (projection._id !== 0 && document._id !== undefined) result._id = document._id;
  for (const [path] of includedFields) {
    if (path === '_id') continue;
    const value = path.split('.').reduce((current, key) => current?.[key], document);
    if (value === undefined) continue;
    const segments = path.split('.');
    let target = result;
    for (const segment of segments.slice(0, -1)) {
      target[segment] ||= {};
      target = target[segment];
    }
    target[segments.at(-1)] = value;
  }
  return result;
}

function cursor(items, query, options = {}) {
  return {
    sort(sortSpec) {
      items.sort((left, right) => {
        for (const [field, direction] of Object.entries(sortSpec)) {
          const a = left[field];
          const b = right[field];
          if (a < b) return -direction;
          if (a > b) return direction;
        }
        return 0;
      });
      return this;
    },
    skip(count) {
      this.offset = count;
      return this;
    },
    limit(count) {
      this.max = count;
      return this;
    },
    async toArray() {
      let result = items.filter((item) => matches(item, query));
      if (options.projection) result = result.map((item) => projectDocument(item, options.projection));
      return result.slice(this.offset || 0, (this.offset || 0) + (this.max || result.length));
    }
  };
}

function createDatabase() {
  const users = [];
  const products = [];
  const categories = [{
    _id: categoryId,
    name: 'Móveis',
    slug: 'moveis',
    subcategories: ['Cadeiras', 'Mesas'],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }];
  const favorites = [];
  const reports = [];

  const db = {
    collection(name) {
      if (name === 'users') return {
        findOne: async (query, options) => {
          const user = users.find((item) => matches(item, query));
          if (!user) return null;
          return options?.projection ? projectDocument(user, options.projection) : user;
        },
        find: (query, options) => cursor(users, query, options),
        async insertOne(document) {
          if (users.some((user) => user.email === document.email)) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
          }
          const insertedId = new ObjectId();
          users.push({ ...document, _id: insertedId });
          return { insertedId };
        },
        async updateOne(query, update) {
          const user = users.find((item) => matches(item, query));
          if (!user) return { matchedCount: 0 };
          Object.assign(user, update.$set);
          for (const field of Object.keys(update.$unset || {})) delete user[field];
          return { matchedCount: 1 };
        },
        async findOneAndUpdate(query, update, options = {}) {
          const user = users.find((item) => matches(item, query));
          if (!user) return null;
          Object.assign(user, update.$set);
          for (const [field, value] of Object.entries(update.$inc || {})) {
            user[field] = (user[field] || 0) + value;
          }
          for (const field of Object.keys(update.$unset || {})) delete user[field];
          return options.projection ? projectDocument(user, options.projection) : user;
        },
        async deleteOne(query) {
          const index = users.findIndex((item) => matches(item, query));
          if (index < 0) return { deletedCount: 0 };
          users.splice(index, 1);
          return { deletedCount: 1 };
        }
      };

      if (name === 'products') return {
        find: (query, options) => cursor(products, query, options),
        async countDocuments(query) {
          return products.filter((item) => matches(item, query)).length;
        },
        async findOne(query, options) {
          const product = products.find((item) => matches(item, query)) || null;
          return product && options?.projection ? projectDocument(product, options.projection) : product;
        },
        async insertOne(document) {
          const insertedId = new ObjectId();
          products.push({ ...document, _id: insertedId });
          return { insertedId };
        },
        async findOneAndUpdate(query, update) {
          const product = products.find((item) => matches(item, query));
          if (!product) return null;
          Object.assign(product, update.$set);
          return product;
        },
        async deleteOne(query) {
          const index = products.findIndex((item) => matches(item, query));
          if (index < 0) return { deletedCount: 0 };
          products.splice(index, 1);
          return { deletedCount: 1 };
        }
      };

      if (name === 'categories') return {
        find: (query) => cursor(categories, query),
        async findOne(query) {
          return categories.find((item) => matches(item, query)) || null;
        },
        async insertOne(document) {
          if (categories.some((item) => item.slug === document.slug)) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
          }
          const insertedId = new ObjectId();
          categories.push({ ...document, _id: insertedId });
          return { insertedId };
        },
        async findOneAndUpdate(query, update) {
          const category = categories.find((item) => matches(item, query));
          if (!category) return null;
          Object.assign(category, update.$set);
          return category;
        }
      };

      if (name === 'favorites') return {
        aggregate(pipeline) {
          const userId = pipeline[0].$match.userId;
          const lookup = pipeline.find((stage) => stage.$lookup)?.$lookup;
          const visibilityFilter = lookup.pipeline.find((stage) => stage.$match)?.$match || {};
          const visibility = Object.fromEntries(Object.entries(visibilityFilter)
            .filter(([field]) => field !== '$expr'));
          const productProjection = lookup.pipeline.find((stage) => stage.$project)?.$project || {};
          const topLevelProjection = pipeline.find((stage) => stage.$project)?.$project || {};
          return {
            async toArray() {
              return favorites.filter((item) => item.userId.equals(userId))
                .map((item) => {
                  const product = products.find((candidate) =>
                    candidate._id.equals(item.productId) && matches(candidate, visibility));
                  if (!product) return null;
                  const projectionFields = Object.fromEntries(Object.entries(productProjection)
                    .filter(([, value]) => value === 1));
                  const safeProduct = projectDocument(product, projectionFields);
                  safeProduct.photos = (product.photos || []).map((photo) =>
                    typeof photo === 'string' ? photo : { url: photo.url });
                  return projectDocument({ ...item, product: safeProduct }, topLevelProjection);
                })
                .filter(Boolean);
            }
          };
        },
        async insertOne(document) {
          if (favorites.some((item) => item.userId.equals(document.userId) && item.productId.equals(document.productId))) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
          }
          favorites.push(document);
          return { insertedId: new ObjectId() };
        },
        async deleteOne(query) {
          const index = favorites.findIndex((item) =>
            item.userId.equals(query.userId) && item.productId.equals(query.productId));
          if (index < 0) return { deletedCount: 0 };
          favorites.splice(index, 1);
          return { deletedCount: 1 };
        },
        async deleteMany(query) {
          for (let index = favorites.length - 1; index >= 0; index--) {
            if (matches(favorites[index], query)) favorites.splice(index, 1);
          }
        }
      };

      if (name === 'reports') return {
        find: (query, options) => cursor(reports, query, options),
        async findOne(query) {
          return reports.find((item) => matches(item, query)) || null;
        },
        async countDocuments(query) {
          return reports.filter((item) => matches(item, query)).length;
        },
        async insertOne(document) {
          if (document.dedupeKey && reports.some((item) => item.dedupeKey === document.dedupeKey)) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
          }
          const insertedId = new ObjectId();
          reports.push({ ...document, _id: insertedId });
          return { insertedId };
        },
        async updateOne(query, update) {
          const report = reports.find((item) => matches(item, query));
          if (!report) return { modifiedCount: 0 };
          Object.assign(report, update.$set);
          return { modifiedCount: 1 };
        },
        async findOneAndUpdate(query, update) {
          const report = reports.find((item) => matches(item, query));
          if (!report) return null;
          Object.assign(report, update.$set);
          return report;
        }
      };

      throw new Error(`Unexpected MongoDB collection: ${name}`);
    }
  };

  return { db, users, products, categories, favorites, reports };
}

let state;
let adminId;
let app;

function tokenFor(id = ownerId) {
  if (state && !state.users.some((user) => user._id.equals(id))) {
    state.users.push({ _id: id, authVersion: 0 });
  }
  return jwt.sign({ id: id.toString(), authVersion: 0 }, process.env.JWT_SECRET);
}

function authHeader(id = ownerId) {
  return { Authorization: `Bearer ${tokenFor(id)}` };
}

beforeEach(() => {
  state = createDatabase();
  Mongo.db = state.db;
  adminId = new ObjectId();
  process.env.ADMIN_USER_IDS = '';
  app = createApp();
});

afterEach(() => {
  Mongo.db = null;
  process.env.ADMIN_USER_IDS = '';
});

test('Portuguese registration and profile routes hash passwords and protect profile data', async () => {
  const signup = await request(app).post('/api/usuarios').send({
    name: 'Maria',
    email: 'maria@example.test',
    password: 'secure-password-123',
    neighborhood: 'Centro'
  });
  assert.equal(signup.status, 201);
  const storedUser = state.users[0];
  assert.notEqual(storedUser.password, 'secure-password-123');
  assert.equal(storedUser.salt.length, 32);
  assert.equal(signup.body.body.user.password, undefined);
  assert.equal(signup.body.body.user.authVersion, undefined);
  assert.equal((await request(app).get('/api/usuarios/me')).status, 401);

  const profile = await request(app).get('/api/usuarios/me')
    .set('Authorization', `Bearer ${signup.body.body.token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.body.name, 'Maria');
  assert.equal(profile.body.body.password, undefined);

  const update = await request(app).put('/api/usuarios/me')
    .set('Authorization', `Bearer ${signup.body.body.token}`)
    .send({ name: 'Maria Silva' });
  assert.equal(update.status, 200);
  assert.equal(state.users[0].name, 'Maria Silva');

  const massAssignment = await request(app).put('/api/usuarios/me')
    .set('Authorization', `Bearer ${signup.body.body.token}`)
    .send({ role: 'admin' });
  assert.equal(massAssignment.status, 400);
});

test('login accepts existing credentials and rate limits repeated failures', async () => {
  const signup = await request(app).post('/api/auth/signup').send({
    email: 'login@example.test',
    password: 'secure-password-123'
  });
  assert.equal(signup.status, 201);
  const login = await request(app).post('/api/auth/login')
    .send({ email: 'login@example.test', password: 'secure-password-123' });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.body.token, 'string');
  assert.equal(login.body.body.user.authVersion, undefined);

  for (let attempt = 0; attempt < 9; attempt++) {
    const failure = await request(app).post('/api/auth/login')
      .send({ email: 'missing@example.test', password: 'bad-password' });
    assert.equal(failure.status, 401);
  }
  const limited = await request(app).post('/api/auth/login')
    .send({ email: 'missing@example.test', password: 'bad-password' });
  assert.equal(limited.status, 429);
});

test('password recovery sends a temporary link and atomically consumes it once', async () => {
  const sentMessages = [];
  const smtpServer = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
      let message = '';
      stream.on('data', (chunk) => { message += chunk.toString(); });
      stream.on('end', () => {
        sentMessages.push(message);
        callback(null, 'Message accepted');
      });
    }
  });
  await new Promise((resolve, reject) => {
    smtpServer.once('error', reject);
    smtpServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    app.set('trust proxy', 1);
    const postFrom = (path, ip) => request(app).post(path).set('X-Forwarded-For', ip);
    const post = (path) => postFrom(path, '198.51.100.42');
    const signup = await post('/api/auth/signup').send({
      name: 'Pessoa de teste',
      email: 'recovery@example.test',
      password: 'old-password-123'
    });
    assert.equal(signup.status, 201);
    const user = state.users.find((item) => item.email === 'recovery@example.test');
    const previousSession = signup.body.body.token;
    assert.equal(signup.body.body.user.authVersion, undefined);
    process.env.EMAIL_MODE = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtpServer.server.address().port);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_FROM = 'test@doaai.local';
    process.env.PUBLIC_APP_URL = 'https://doaai.example.test';

    const unknownEmail = await post('/api/auth/forgot-password')
      .send({ email: 'unknown@example.test' });
    assert.equal(unknownEmail.status, 200);
    assert.equal(unknownEmail.body.body, 'Se este e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.');
    const invalidEmail = await post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    assert.equal(invalidEmail.status, 400);
    const forgot = await post('/api/auth/forgot-password')
      .send({ email: 'RECOVERY@example.test' });
    assert.equal(forgot.status, 200);
    assert.equal(forgot.body.body, 'Se este e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.');
    assert.equal(sentMessages.length, 1);
    const firstEmail = sentMessages[0].replace(/=\r?\n/g, '');
    assert.match(firstEmail, /https:\/\/doaai\.example\.test\/redefinir-senha#token=/);
    assert.match(firstEmail, /15 minutos/);

    const token = [...firstEmail.matchAll(/token=(?:3D)?([a-f\d]{64})/ig)]
      .map((match) => match[1])
      .find((candidate) =>
        crypto.createHash('sha256').update(candidate).digest('hex') === user.passwordResetTokenHash);
    assert.ok(token);
    assert.equal(user.passwordResetTokenHash.length, 64);
    assert.notEqual(user.passwordResetTokenHash, token);
    assert.ok(user.passwordResetExpiresAt > new Date());
    assert.ok(user.passwordResetExpiresAt.getTime() <= Date.now() + 15 * 60 * 1000);
    assert.ok(user.passwordResetExpiresAt.getTime() >= Date.now() + 14 * 60 * 1000);

    const tokenBeforeCooldown = user.passwordResetTokenHash;
    const cooldown = await post('/api/auth/forgot-password')
      .send({ email: 'recovery@example.test' });
    assert.equal(cooldown.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.equal(user.passwordResetTokenHash, tokenBeforeCooldown);

    const mismatch = await post('/api/auth/reset-password').send({
      token,
      password: 'new-password-123',
      passwordConfirmation: 'different-password'
    });
    assert.equal(mismatch.status, 400);
    const invalidToken = await post('/api/auth/reset-password').send({
      token: '0'.repeat(64),
      password: 'new-password-123',
      passwordConfirmation: 'new-password-123'
    });
    assert.equal(invalidToken.status, 400);

    user.passwordResetRequestedAt = new Date(0);
    const secondForgot = await post('/api/auth/forgot-password')
      .send({ email: 'recovery@example.test' });
    assert.equal(secondForgot.status, 200);
    const secondEmail = sentMessages[1].replace(/=\r?\n/g, '');
    const secondToken = [...secondEmail.matchAll(/token=(?:3D)?([a-f\d]{64})/ig)]
      .map((match) => match[1])
      .find((candidate) =>
        crypto.createHash('sha256').update(candidate).digest('hex') === user.passwordResetTokenHash);
    assert.ok(secondToken);
    assert.notEqual(user.passwordResetTokenHash, crypto.createHash('sha256').update(token).digest('hex'));
    const invalidatedToken = await post('/api/auth/reset-password').send({
      token,
      password: 'new-password-123',
      passwordConfirmation: 'new-password-123'
    });
    assert.equal(invalidatedToken.status, 400);

    user.passwordResetExpiresAt = new Date(Date.now() - 1000);
    const expiredToken = await post('/api/auth/reset-password').send({
      token: secondToken,
      password: 'new-password-123',
      passwordConfirmation: 'new-password-123'
    });
    assert.equal(expiredToken.status, 400);

    user.passwordResetRequestedAt = new Date(0);
    const thirdForgot = await post('/api/auth/forgot-password')
      .send({ email: 'recovery@example.test' });
    assert.equal(thirdForgot.status, 200);
    const thirdEmail = sentMessages[2].replace(/=\r?\n/g, '');
    const thirdToken = [...thirdEmail.matchAll(/token=(?:3D)?([a-f\d]{64})/ig)]
      .map((match) => match[1])
      .find((candidate) =>
        crypto.createHash('sha256').update(candidate).digest('hex') === user.passwordResetTokenHash);
    assert.ok(thirdToken);
    const resetPayload = {
      token: thirdToken,
      password: 'new-password-123',
      passwordConfirmation: 'new-password-123'
    };
    const concurrentResets = await Promise.all([
      post('/api/auth/reset-password').send(resetPayload),
      post('/api/auth/reset-password').send(resetPayload)
    ]);
    assert.deepEqual(concurrentResets.map((response) => response.status).sort(), [200, 400]);
    assert.equal(await verifyPassword('new-password-123', user.password, user.salt), true);
    assert.equal(user.passwordResetTokenHash, undefined);
    assert.equal(user.passwordResetExpiresAt, undefined);

    const reusedToken = await post('/api/auth/reset-password').send({
      token: thirdToken,
      password: 'another-password-123',
      passwordConfirmation: 'another-password-123'
    });
    assert.equal(reusedToken.status, 400);

    const oldLogin = await post('/api/auth/login')
      .send({ email: 'recovery@example.test', password: 'old-password-123' });
    assert.equal(oldLogin.status, 401);
    const newLogin = await post('/api/auth/login')
      .send({ email: 'recovery@example.test', password: 'new-password-123' });
    assert.equal(newLogin.status, 200);
    assert.equal((await request(app).get('/api/usuarios/me')
      .set('Authorization', `Bearer ${previousSession}`)).status, 401);
    assert.equal((await request(app).get('/api/usuarios/me')
      .set('Authorization', `Bearer ${newLogin.body.body.token}`)).status, 200);
    const rateLimited = await post('/api/auth/forgot-password')
      .send({ email: 'unknown@example.test' });
    assert.equal(rateLimited.status, 429);

    user.passwordResetRequestedAt = new Date(0);
    process.env.SMTP_PORT = '1';
    const deliveryFailure = await postFrom('/api/auth/forgot-password', '198.51.100.43')
      .send({ email: 'recovery@example.test' });
    assert.equal(deliveryFailure.status, 200);
    assert.equal(deliveryFailure.body.body, 'Se este e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.');
    assert.equal(user.passwordResetTokenHash, undefined);
    assert.equal(user.passwordResetExpiresAt, undefined);
  } finally {
    await new Promise((resolve) => smtpServer.close(resolve));
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_FROM;
    delete process.env.PUBLIC_APP_URL;
  }
});

test('product creation uses token owner, validates category, and blocks other owners', async () => {
  const payload = {
    name: 'Cadeira de escritório',
    description: 'Em bom estado',
    categoryId: categoryId.toString(),
    subcategory: 'Cadeiras',
    condition: 'Bom',
    neighborhood: 'Centro',
    ownerId: anotherUserId.toString()
  };
  assert.equal((await request(app).post('/api/produtos').send(payload)).status, 401);
  const created = await request(app).post('/api/produtos').set(authHeader()).send(payload);
  assert.equal(created.status, 201);
  const product = state.products[0];
  assert.ok(product.ownerId.equals(ownerId));
  assert.equal(product.status, 'disponivel');

  const invalidCategory = await request(app).post('/api/produtos')
    .set(authHeader()).send({ ...payload, subcategory: 'Sofás' });
  assert.equal(invalidCategory.status, 400);

  const forbiddenUpdate = await request(app).put(`/api/produtos/${product._id}`)
    .set(authHeader(anotherUserId)).send({ name: 'Alterado' });
  assert.equal(forbiddenUpdate.status, 403);
  const allowedUpdate = await request(app).put(`/api/produtos/${product._id}`)
    .set(authHeader()).send({ name: 'Cadeira revisada' });
  assert.equal(allowedUpdate.status, 200);
  assert.equal(product.name, 'Cadeira revisada');
  const changedStatus = await request(app).patch(`/api/produtos/${product._id}/status`)
    .set(authHeader()).send({ status: 'reservado' });
  assert.equal(changedStatus.status, 200);
  assert.equal(product.status, 'reservado');
  const forbiddenDelete = await request(app).delete(`/api/produtos/${product._id}`)
    .set(authHeader(anotherUserId));
  assert.equal(forbiddenDelete.status, 403);
  const allowedDelete = await request(app).delete(`/api/produtos/${product._id}`).set(authHeader());
  assert.equal(allowedDelete.status, 200);
  assert.equal(state.products.length, 0);
});

test('product search aliases are validated and uploaded bytes are checked', async () => {
  const publicId = new ObjectId();
  const reservedId = new ObjectId();
  const donatedId = new ObjectId();
  const hiddenId = new ObjectId();
  const privateId = new ObjectId();
  const deletedId = new ObjectId();
  const moderatedId = new ObjectId();
  const invisibleId = new ObjectId();
  const hiddenModerationId = new ObjectId();
  const deletedModerationId = new ObjectId();
  state.products.push({
    _id: publicId,
    ownerId,
    name: 'Mesa de madeira',
    description: 'Usada',
    categoryId,
    subcategory: 'Mesas',
    condition: 'Bom',
    neighborhood: 'Centro',
    status: 'disponivel',
    photos: [{ url: 'https://images.example.test/table.jpg', publicId: 'private-media-id' }],
    internalFlag: 'internal',
    moderationNotes: 'private moderation note',
    createdAt: new Date()
  }, {
    _id: reservedId,
    ownerId,
    name: 'Cadeira reservada',
    status: 'reservado',
    createdAt: new Date()
  }, {
    _id: donatedId,
    ownerId,
    name: 'Mesa doada',
    status: 'doado',
    createdAt: new Date()
  }, {
    _id: hiddenId,
    ownerId,
    name: 'Produto oculto',
    status: 'disponivel',
    hidden: true,
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: privateId,
    ownerId,
    name: 'Produto privado',
    status: 'disponivel',
    visibility: 'private',
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: deletedId,
    ownerId,
    name: 'Produto excluído',
    status: 'disponivel',
    deletedAt: new Date(),
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: moderatedId,
    ownerId,
    name: 'Produto removido pela moderação',
    status: 'disponivel',
    moderationStatus: 'removed',
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: invisibleId,
    ownerId,
    name: 'Produto não visível',
    status: 'disponivel',
    visible: false,
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: hiddenModerationId,
    ownerId,
    name: 'Produto ocultado pela moderação',
    status: 'disponivel',
    moderationStatus: 'hidden',
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  }, {
    _id: deletedModerationId,
    ownerId,
    name: 'Produto excluído pela moderação',
    status: 'disponivel',
    moderationStatus: 'deleted',
    categoryId,
    neighborhood: 'Centro',
    createdAt: new Date()
  });
  const listing = await request(app).get('/api/produtos?categoria=moveis&bairro=Centro');
  assert.equal(listing.status, 200);
  assert.equal(listing.body.body.total, 1);
  const publicProduct = listing.body.body.items[0];
  assert.equal(publicProduct._id, publicId.toString());
  assert.equal(publicProduct.ownerId, undefined);
  assert.equal(publicProduct.internalFlag, undefined);
  assert.equal(publicProduct.moderationNotes, undefined);
  assert.equal(publicProduct.photos[0].publicId, undefined);
  assert.equal(publicProduct.photos[0].url, 'https://images.example.test/table.jpg');
  assert.equal((await request(app).get(`/api/produtos?status=reservado`)).body.body.total, 1);
  assert.equal((await request(app).get(`/api/produtos?status=doado`)).body.body.total, 1);
  assert.equal((await request(app).get(`/api/produtos/${hiddenId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${privateId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${deletedId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${moderatedId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${invisibleId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${hiddenModerationId}`)).status, 404);
  assert.equal((await request(app).get(`/api/produtos/${deletedModerationId}`)).status, 404);
  const invalidSearch = await request(app).get('/api/produtos?categoria[$ne]=x');
  assert.equal(invalidSearch.status, 400);

  const invalidUpload = await request(app).post('/api/produtos').set(authHeader())
    .field('name', 'Imagem inválida')
    .attach('photos', Buffer.from('not-an-image'), { filename: 'invalid.png', contentType: 'image/png' });
  assert.equal(invalidUpload.status, 400);
});

test('Portuguese category routes require admin and DELETE deactivates the category', async () => {
  const denied = await request(app).post('/api/categorias')
    .set(authHeader()).send({ name: 'Decoração', subcategories: [] });
  assert.equal(denied.status, 403);

  process.env.ADMIN_USER_IDS = adminId.toString();
  const created = await request(app).post('/api/categorias')
    .set(authHeader(adminId)).send({ name: 'Decoração', subcategories: ['Quadros'] });
  assert.equal(created.status, 201);
  const category = created.body.body;
  const fetched = await request(app).get(`/api/categorias/${category._id}`);
  assert.equal(fetched.status, 200);
  const deleted = await request(app).delete(`/api/categorias/${category._id}`)
    .set(authHeader(adminId));
  assert.equal(deleted.status, 200);
  assert.equal(state.categories.find((item) => item._id.equals(category._id)).active, false);
  assert.equal((await request(app).get(`/api/categorias/${category._id}`)).status, 404);
});

test('Portuguese favorites routes require authentication and reject duplicates', async () => {
  const productId = new ObjectId();
  state.products.push({
    _id: productId,
    ownerId,
    name: 'Livro',
    status: 'disponivel',
    description: 'Uma descrição pública.',
    categoryId,
    photos: [{ url: 'https://images.example.test/book.jpg', publicId: 'private-book-id' }],
    internalFlag: 'private',
    createdAt: new Date()
  });
  const hiddenProductId = new ObjectId();
  state.products.push({
    _id: hiddenProductId,
    ownerId,
    name: 'Livro privado',
    status: 'disponivel',
    visibility: 'private',
    createdAt: new Date()
  });
  assert.equal((await request(app).get('/api/favoritos')).status, 401);
  assert.equal((await request(app).post('/api/favoritos').send({ produtoId: productId.toString() })).status, 401);

  const added = await request(app).post('/api/favoritos').set(authHeader())
    .send({ produtoId: productId.toString() });
  assert.equal(added.status, 201);
  assert.equal((await request(app).post('/api/favoritos').set(authHeader())
    .send({ produtoId: hiddenProductId.toString() })).status, 404);
  state.favorites.push({ userId: anotherUserId, productId, createdAt: new Date() });
  state.favorites.push({ userId: ownerId, productId: hiddenProductId, createdAt: new Date() });
  const duplicate = await request(app).post('/api/favoritos').set(authHeader())
    .send({ produtoId: productId.toString() });
  assert.equal(duplicate.status, 409);
  const listed = await request(app).get('/api/favoritos').set(authHeader());
  assert.equal(listed.status, 200);
  assert.equal(listed.body.body.length, 1);
  const favorite = listed.body.body[0];
  assert.equal(favorite.productId, productId.toString());
  assert.equal(favorite.userId, undefined);
  assert.equal(favorite.product.ownerId, undefined);
  assert.equal(favorite.product.internalFlag, undefined);
  assert.equal(favorite.product.photos[0].publicId, undefined);
  assert.equal(state.favorites.length, 3);
  assert.equal((await request(app).delete(`/api/favoritos/${productId}`).set(authHeader())).status, 200);
  assert.equal(state.favorites.length, 2);
  assert.ok(state.favorites.some((item) => item.userId.equals(anotherUserId)));
});

test('Portuguese reports require login, restrict moderation to admins, and validate report status', async () => {
  assert.equal((await request(app).post('/api/denuncias').send({})).status, 401);
  assert.equal((await request(app).get('/api/denuncias').set(authHeader())).status, 403);
  assert.equal((await request(app).patch(`/api/denuncias/${new ObjectId()}`)
    .set(authHeader()).send({ status: 'resolvida' })).status, 403);

  const productId = new ObjectId();
  state.products.push({ _id: productId, ownerId, name: 'Produto denunciável', status: 'disponivel' });
  const invalidReason = await request(app).post('/api/denuncias').set(authHeader())
    .send({ produtoId: productId.toString(), motivo: 'spam' });
  assert.equal(invalidReason.status, 400);

  process.env.ADMIN_USER_IDS = adminId.toString();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';
  process.env.SMTP_FROM = 'test@doaai.local';
  process.env.PUBLIC_APP_URL = 'http://localhost:5173';
  const sendFailure = await request(app).post('/api/denuncias').set(authHeader())
    .send({ produtoId: productId.toString(), motivo: 'Outros', descricao: 'Teste' });
  assert.equal(sendFailure.status, 502);
  assert.equal(state.reports.length, 1);

  const list = await request(app).get('/api/denuncias').set(authHeader(adminId));
  assert.equal(list.status, 200);
  assert.equal(list.body.body.length, 1);
  const changed = await request(app).patch(`/api/denuncias/${state.reports[0]._id}`)
    .set(authHeader(adminId)).send({ status: 'em_analise' });
  assert.equal(changed.status, 200);
  assert.equal(state.reports[0].status, 'em_analise');
  const invalidStatus = await request(app).patch(`/api/denuncias/${state.reports[0]._id}`)
    .set(authHeader(adminId)).send({ status: 'closed' });
  assert.equal(invalidStatus.status, 400);
});

test('CORS allows configured origins and omits access for untrusted origins', async () => {
  const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  const denied = await request(app).get('/api/health').set('Origin', 'https://untrusted.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
