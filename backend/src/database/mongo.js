// Este arquivo cuida da conexão com o MongoDB.
// O objetivo é centralizar a lógica de banco em um único lugar,
// para o restante da aplicação não precisar saber detalhes de conexão.

import { MongoClient } from 'mongodb';
import { createCategoryDocument, DEFAULT_CATEGORIES } from '../models/Category.js';

// Objeto Mongo que encapsula toda a conexão e reutiliza o cliente
// para não abrir várias conexões desnecessárias.
const Mongo = {
  // Guarda a conexão ativa do cliente MongoDB
  client: null,
  db: null,

  // Método responsável por conectar ao banco
  async connect({ mongoConnectionString, mongoDbName }) {
    // Valida se a string de conexão foi enviada
    if (!mongoConnectionString) {
      throw new Error('MONGO_CS não foi encontrado. Verifique o arquivo .env.');
    }

    // Valida se o nome do banco foi enviado
    if (!mongoDbName) {
      throw new Error('MONGO_DB_NAME não foi encontrado. Verifique o arquivo .env.');
    }

    // Só cria o cliente se ainda não existir, para evitar múltiplas conexões
    if (!this.client) {
      this.client = new MongoClient(mongoConnectionString);
      await this.client.connect();
      console.log('Conexão com o MongoDB realizada com sucesso!');
    }

    this.db = this.client.db(mongoDbName);
    await this.ensureIndexes();

    // Retorna a referência ao banco específico que queremos usar
    return this.db;
  },

  async ensureIndexes() {
    const products = this.db.collection('products');
    await Promise.all([
      products.updateMany({ status: 'available' }, { $set: { status: 'disponivel' } }),
      products.updateMany({ status: 'reserved' }, { $set: { status: 'reservado' } }),
      products.updateMany({ status: 'donated' }, { $set: { status: 'doado' } })
    ]);

    await Promise.all([
      this.db.collection('users').createIndex({ email: 1 }, { unique: true }),
      this.db.collection('users').createIndex(
        { 'socialAccounts.google': 1 },
        { unique: true, sparse: true, name: 'unique_google_social_account' }
      ),
      this.db.collection('users').createIndex(
        { 'socialAccounts.facebook': 1 },
        { unique: true, sparse: true, name: 'unique_facebook_social_account' }
      ),
      this.db.collection('users').createIndex(
        { 'socialAccounts.microsoft': 1 },
        { unique: true, sparse: true, name: 'unique_microsoft_social_account' }
      ),
      this.db.collection('socialAuthTransactions').createIndex(
        { stateHash: 1 },
        { unique: true, name: 'unique_social_auth_state' }
      ),
      this.db.collection('socialAuthTransactions').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'expire_social_auth_transactions' }
      ),
      this.db.collection('socialAuthExchangeCodes').createIndex(
        { codeHash: 1 },
        { unique: true, name: 'unique_social_exchange_code' }
      ),
      this.db.collection('socialAuthExchangeCodes').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'expire_social_exchange_codes' }
      ),
      products.createIndex({ status: 1, categoryId: 1, createdAt: -1 }),
      products.createIndex(
        { name: 'text', description: 'text' },
        { name: 'products_text_search', default_language: 'portuguese' }
      ),
      products.createIndex({ status: 1, categoryId: 1, subcategory: 1, condition: 1, createdAt: -1 }),
      products.createIndex({ neighborhood: 1, status: 1, createdAt: -1 }),
      products.createIndex({ ownerId: 1, status: 1, createdAt: -1 }),
      this.db.collection('categories').createIndex({ slug: 1 }, { unique: true }),
      this.db.collection('categories').createIndex({ active: 1, name: 1 }),
      this.db.collection('favorites').createIndex({ userId: 1, productId: 1 }, { unique: true }),
      this.db.collection('favorites').createIndex({ userId: 1, createdAt: -1 }),
      this.db.collection('reports').createIndex({ dedupeKey: 1 }, { unique: true, sparse: true }),
      this.db.collection('reports').createIndex({ status: 1, createdAt: -1 }),
      this.db.collection('reports').createIndex({ reporterId: 1, createdAt: -1 })
    ]);

    const categories = this.db.collection('categories');
    await Promise.all(DEFAULT_CATEGORIES.map((category) => {
      const document = createCategoryDocument(category);
      return categories.updateOne(
        { slug: category.slug },
        { $setOnInsert: document },
        { upsert: true }
      );
    }));
  },

  // Método para encerrar a conexão quando a aplicação parar
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
};

export { Mongo };