import { ObjectId } from 'mongodb';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import ProductDataAccess from '../dataAccess/produtoDataAccess.js';
import CategoryDataAccess from '../dataAccess/categories.js';
import { Mongo } from '../database/mongo.js';
import { createProductDocument, DONATION_STATUSES } from '../models/produtos.js';
import { isObjectId, requiredText } from '../helpers/validation.js';
import { notFound, ok, serverError } from '../helpers/httpResponse.js';

const productDataAccess = new ProductDataAccess();
const categoryDataAccess = new CategoryDataAccess();

const invalid = (message) => ({ success: false, statusCode: 400, body: message });

async function uploadImages(files = []) {
  if (files.length && !isCloudinaryConfigured) {
    throw new Error('Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET para enviar imagens.');
  }
  const uploaded = [];
  try {
    for (const file of files) {
      const photo = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream({ folder: 'doaai', resource_type: 'image' }, (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url || !result.public_id) {
            return reject(new Error('Cloudinary não retornou os dados da imagem enviada.'));
          }
          return resolve({ url: result.secure_url, publicId: result.public_id });
        }).end(file.buffer);
      });
      uploaded.push(photo);
    }
    return uploaded;
  } catch (error) {
    const cleanupFailures = await destroyImages(uploaded);
    if (cleanupFailures.length) {
      throw new Error(`Falha no upload; não foi possível limpar ${cleanupFailures.length} imagem(ns) enviada(s). ${error.message}`);
    }
    throw error;
  }
}

async function destroyImages(photos = []) {
  const managedPhotos = photos.filter((photo) =>
    photo && typeof photo === 'object' && typeof photo.publicId === 'string' && photo.publicId
  );
  const results = await Promise.allSettled(
    managedPhotos.map((photo) => cloudinary.uploader.destroy(photo.publicId, { resource_type: 'image' }))
  );
  const failures = [];
  results.forEach((result, index) => {
    const deleted = result.status === 'fulfilled' &&
      ['ok', 'not found'].includes(result.value?.result);
    if (!deleted) {
      failures.push(managedPhotos[index]);
      console.error(`Não foi possível remover a imagem ${managedPhotos[index].publicId} do Cloudinary:`,
        result.status === 'rejected' ? result.reason : result.value?.result);
    }
  });
  return failures;
}

function parsePhotoRemovals(value) {
  if (value === undefined) return { publicIds: [] };
  let publicIds = value;
  if (typeof value === 'string') {
    try {
      publicIds = JSON.parse(value);
    } catch {
      return { error: 'removePhotos deve ser uma lista JSON de publicIds.' };
    }
  }
  if (!Array.isArray(publicIds) || publicIds.length > 5 ||
      publicIds.some((publicId) => typeof publicId !== 'string' ||
        !publicId.trim() || publicId.length > 255)) {
    return { error: 'removePhotos deve conter até cinco publicIds válidos.' };
  }
  return { publicIds: [...new Set(publicIds)] };
}

function parseListOptions(query, ownerId) {
  const allowedParameters = new Set([
    'category', 'categoria', 'subcategory', 'subcategoria', 'condition', 'conservacao',
    'neighborhood', 'bairro', 'search', 'busca', 'status', 'page', 'limit', 'sort', 'ordenacao'
  ]);
  const unsupportedParameter = Object.keys(query).find((key) => !allowedParameters.has(key));
  if (unsupportedParameter) {
    return { error: `Parâmetro de busca não suportado: ${unsupportedParameter}.` };
  }

  const aliases = [
    ['category', 'categoria', 100],
    ['subcategory', 'subcategoria', 80],
    ['condition', 'conservacao', 80],
    ['neighborhood', 'bairro', 120],
    ['search', 'busca', 100],
    ['status', 'status', 20]
  ];
  const filters = {};
  for (const [english, portuguese, maxLength] of aliases) {
    const englishValue = query[english];
    const portugueseValue = query[portuguese];
    if (english !== portuguese && englishValue !== undefined && portugueseValue !== undefined &&
        englishValue !== portugueseValue) {
      return { error: `Use apenas um dos parâmetros ${english} ou ${portuguese}.` };
    }
    const value = portugueseValue ?? englishValue;
    if (value !== undefined &&
        (typeof value !== 'string' || !requiredText(value, maxLength))) {
      return { error: `Filtro ${portuguese} inválido.` };
    }
    filters[english] = typeof value === 'string' ? value.trim() : undefined;
  }

  const pageValue = query.page ?? '1';
  const limitValue = query.limit ?? '20';
  if (typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue) ||
      typeof limitValue !== 'string' || !/^[1-9]\d*$/.test(limitValue)) {
    return { error: 'Paginação inválida.' };
  }
  const parsedPage = Number.parseInt(pageValue, 10);
  const parsedLimit = Number.parseInt(limitValue, 10);
  if (!Number.isSafeInteger(parsedPage) || !Number.isSafeInteger(parsedLimit)) {
    return { error: 'Paginação inválida.' };
  }
  const page = Math.min(100000, parsedPage);
  const limit = Math.min(50, parsedLimit);
  if (query.sort !== undefined && query.ordenacao !== undefined &&
      query.sort !== query.ordenacao) {
    return { error: 'Use apenas um dos parâmetros sort ou ordenacao.' };
  }
  const sortValue = query.sort ?? query.ordenacao ?? 'recent';
  if (typeof sortValue !== 'string' || !['recent', 'oldest', 'recentes', 'antigos'].includes(sortValue)) {
    return { error: 'Ordenação inválida. Use recent ou oldest.' };
  }
  const status = filters.status || (ownerId ? undefined : 'disponivel');
  if (status && !DONATION_STATUSES.includes(status)) {
    return { error: 'Status da doação inválido.' };
  }
  return {
    options: {
      ownerId,
      category: filters.category,
      subcategory: filters.subcategory,
      condition: filters.condition,
      neighborhood: filters.neighborhood,
      status,
      search: filters.search,
      page,
      limit,
      sort: ['oldest', 'antigos'].includes(sortValue) ? 'oldest' : 'recent'
    }
  };
}

function productFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Corpo da requisição inválido.' };
  }
  const fields = ['name', 'description', 'subcategory', 'condition', 'neighborhood'];
  const updates = {};
  for (const field of fields) {
    if (body[field] !== undefined) {
      if (!requiredText(body[field], field === 'description' ? 2000 : 120)) {
        return { error: `${field} inválido.` };
      }
      updates[field] = body[field].trim();
    }
  }
  if (body.categoryId !== undefined || body.category !== undefined) {
    const categoryId = body.categoryId ?? body.category;
    if (!isObjectId(categoryId)) return { error: 'categoryId inválido.' };
    updates.categoryId = categoryId;
  }
  if (body.status !== undefined) {
    if (!DONATION_STATUSES.includes(body.status)) return { error: 'Status da doação inválido.' };
    updates.status = body.status;
  }
  return { updates };
}

export default class ProductController {
  async list(query, ownerId) {
    try {
      const { options, error } = parseListOptions(query, ownerId);
      if (error) return invalid(error);
      if (options.category) {
        const category = isObjectId(options.category)
          ? await categoryDataAccess.findActiveById(options.category)
          : await categoryDataAccess.findBySlug(options.category.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
        if (!category) {
          return ok({
            items: [],
            total: 0,
            page: options.page,
            limit: options.limit,
            pages: 0,
            hasNextPage: false,
            hasPreviousPage: options.page > 1
          });
        }
        options.categoryId = category._id.toString();
        delete options.category;
      }
      return ok(await productDataAccess.list(options));
    } catch (error) {
      return serverError(error);
    }
  }

  async listMine(userId, query) {
    try {
      const [result, summary] = await Promise.all([
        this.list(query, userId),
        productDataAccess.countByOwnerStatus(userId)
      ]);
      if (!result.success) return result;
      return { ...result, body: { ...result.body, summary } };
    } catch (error) {
      return serverError(error);
    }
  }

  async get(id) {
    if (!isObjectId(id)) return invalid('ID de produto inválido.');
    try {
      const product = await productDataAccess.findPublicById(id);
      return product ? ok(product) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }

  async create(userId, body, files = []) {
    const fields = productFields(body);
    if (fields.error) return invalid(fields.error);
    if (!isObjectId(fields.updates.categoryId)) return invalid('categoryId é obrigatório e deve identificar uma categoria.');
    for (const field of ['name', 'description', 'subcategory', 'condition', 'neighborhood']) {
      if (!fields.updates[field]) return invalid(`${field} é obrigatório.`);
    }

    if (files.length && !isCloudinaryConfigured) {
      return { success: false, statusCode: 503, body: 'Upload indisponível: configure as credenciais do Cloudinary.' };
    }

    try {
      const category = await Mongo.db.collection('categories').findOne({
        _id: new ObjectId(fields.updates.categoryId),
        active: true
      });
      if (!category) return invalid('Categoria não encontrada ou inativa.');
      if (!category.subcategories?.includes(fields.updates.subcategory)) {
        return invalid('Subcategoria não pertence à categoria selecionada.');
      }
      const photos = await uploadImages(files);
      const product = createProductDocument({
        ownerId: new ObjectId(userId),
        ...fields.updates,
        categoryId: category._id,
        photos
      });
      try {
        return { success: true, statusCode: 201, body: await productDataAccess.create(product) };
      } catch (error) {
        const cleanupFailures = await destroyImages(photos);
        if (cleanupFailures.length) {
          console.error(`Falha ao criar o produto; ${cleanupFailures.length} imagem(ns) podem permanecer no Cloudinary.`);
        }
        throw error;
      }
    } catch (error) {
      return serverError(error);
    }
  }

  async update(id, userId, body, files = []) {
    if (!isObjectId(id)) return invalid('ID de produto inválido.');
    const fields = productFields(body);
    if (fields.error) return invalid(fields.error);
    const replacePhotos = body?.replacePhotos === true || body?.replacePhotos === 'true';
    if (body?.replacePhotos !== undefined && body.replacePhotos !== true &&
        body.replacePhotos !== false && body.replacePhotos !== 'true' && body.replacePhotos !== 'false') {
      return invalid('replacePhotos deve ser booleano.');
    }
    const removals = parsePhotoRemovals(body?.removePhotos);
    if (removals.error) return invalid(removals.error);
    if (replacePhotos && removals.publicIds.length) {
      return invalid('Use replacePhotos ou removePhotos, não ambos na mesma atualização.');
    }
    if (!Object.keys(fields.updates).length && !files.length && !replacePhotos && !removals.publicIds.length) {
      return invalid('Informe ao menos um campo para atualizar.');
    }
    if (files.length && !isCloudinaryConfigured) {
      return { success: false, statusCode: 503, body: 'Upload indisponível: configure as credenciais do Cloudinary.' };
    }

    try {
      const existing = await productDataAccess.findById(id);
      if (!existing) return notFound();
      if (existing.ownerId.toString() !== userId) {
        return { success: false, statusCode: 403, body: 'Você não pode alterar esta publicação.' };
      }
      const existingPhotos = existing.photos || [];
      const existingPublicIds = new Set(existingPhotos.map((photo) => photo?.publicId).filter(Boolean));
      if (removals.publicIds.some((publicId) => !existingPublicIds.has(publicId))) {
        return invalid('Uma ou mais fotografias não pertencem a este produto.');
      }
      const removedPhotos = replacePhotos
        ? existingPhotos
        : existingPhotos.filter((photo) => removals.publicIds.includes(photo?.publicId));
      const removedPublicIds = new Set(removedPhotos.map((photo) => photo?.publicId).filter(Boolean));
      const retainedPhotos = existingPhotos.filter((photo) => !removedPublicIds.has(photo?.publicId));
      if (retainedPhotos.length + files.length > 5) {
        return invalid('O produto pode ter no máximo cinco fotografias.');
      }
      if ((files.length || removedPublicIds.size) && !isCloudinaryConfigured) {
        return { success: false, statusCode: 503, body: 'Upload e remoção de fotografias exigem as credenciais do Cloudinary.' };
      }
      if (fields.updates.categoryId || fields.updates.subcategory) {
        const categoryId = fields.updates.categoryId || existing.categoryId;
        const category = await Mongo.db.collection('categories').findOne({
          _id: new ObjectId(categoryId),
          active: true
        });
        if (!category) return invalid('Categoria não encontrada ou inativa.');
        const subcategory = fields.updates.subcategory || existing.subcategory;
        if (!category.subcategories?.includes(subcategory)) {
          return invalid('Subcategoria não pertence à categoria selecionada.');
        }
        if (fields.updates.categoryId) fields.updates.categoryId = category._id;
      }
      const uploadedPhotos = await uploadImages(files);
      if (replacePhotos || removals.publicIds.length || files.length) {
        fields.updates.photos = [...retainedPhotos, ...uploadedPhotos];
      }
      let product;
      try {
        product = await productDataAccess.update(id, userId, fields.updates);
      } catch (error) {
        const cleanupFailures = await destroyImages(uploadedPhotos);
        if (cleanupFailures.length) {
          console.error(`Falha ao editar o produto; ${cleanupFailures.length} nova(s) imagem(ns) podem permanecer no Cloudinary.`);
        }
        throw error;
      }
      if (!product) {
        const cleanupFailures = await destroyImages(uploadedPhotos);
        if (cleanupFailures.length) {
          console.error(`Produto não atualizado; ${cleanupFailures.length} nova(s) imagem(ns) podem permanecer no Cloudinary.`);
        }
        return notFound();
      }
      const removalFailures = await destroyImages(removedPhotos);
      if (removalFailures.length) {
        await productDataAccess.restorePhotos(id, userId, removalFailures);
        return {
          success: false,
          statusCode: 502,
          body: 'Os demais dados foram atualizados, mas não foi possível remover todas as fotografias. As imagens não removidas foram mantidas no produto.'
        };
      }
      return ok(product);
    } catch (error) {
      return serverError(error);
    }
  }

  async updateStatus(id, userId, status) {
    if (!isObjectId(id)) return invalid('ID de produto inválido.');
    if (!DONATION_STATUSES.includes(status)) return invalid('Status deve ser disponivel, reservado ou doado.');
    try {
      const existing = await productDataAccess.findById(id);
      if (!existing) return notFound();
      if (existing.ownerId.toString() !== userId) {
        return { success: false, statusCode: 403, body: 'Você não pode alterar esta publicação.' };
      }
      const product = await productDataAccess.update(id, userId, { status });
      return product ? ok(product) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }

  async delete(id, userId) {
    if (!isObjectId(id)) return invalid('ID de produto inválido.');
    try {
      const existing = await productDataAccess.findById(id);
      if (!existing) return notFound();
      if (existing.ownerId.toString() !== userId) {
        return { success: false, statusCode: 403, body: 'Você não pode excluir esta publicação.' };
      }
      const photos = existing.photos || [];
      if (photos.some((photo) => photo?.publicId) && !isCloudinaryConfigured) {
        return { success: false, statusCode: 503, body: 'Configure o Cloudinary para excluir as fotografias desta publicação.' };
      }
      if (photos.length) {
        const clearedProduct = await productDataAccess.update(id, userId, { photos: [] });
        if (!clearedProduct) return notFound();
        const removalFailures = await destroyImages(photos);
        if (removalFailures.length) {
          await productDataAccess.restorePhotos(id, userId, removalFailures);
          return {
            success: false,
            statusCode: 502,
            body: 'Não foi possível excluir todas as fotografias; a publicação foi mantida.'
          };
        }
      }
      const result = await productDataAccess.delete(id, userId);
      if (!result.deletedCount) return notFound();
      await Mongo.db.collection('favorites').deleteMany({ productId: new ObjectId(id) });
      return ok({ message: 'Publicação excluída com sucesso.' });
    } catch (error) {
      return serverError(error);
    }
  }
}