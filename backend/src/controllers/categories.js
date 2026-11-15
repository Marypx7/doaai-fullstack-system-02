import CategoryDataAccess from '../dataAccess/categories.js';
import { createCategoryDocument, createCategoryUpdates } from '../models/Category.js';
import { isObjectId, requiredText } from '../helpers/validation.js';
import { notFound, ok, serverError } from '../helpers/httpResponse.js';

const dataAccess = new CategoryDataAccess();
const invalid = (body) => ({ success: false, statusCode: 400, body });

function makeSlug(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeSubcategories(value) {
  if (!Array.isArray(value) || value.length > 100 ||
      value.some((subcategory) => !requiredText(subcategory, 80))) {
    return { error: 'Subcategorias devem ser uma lista com até 100 textos válidos.' };
  }
  const subcategories = [];
  const seen = new Set();
  for (const subcategory of value) {
    const normalized = subcategory.trim();
    const key = normalized.toLocaleLowerCase('pt-BR');
    if (!seen.has(key)) {
      subcategories.push(normalized);
      seen.add(key);
    }
  }
  return { subcategories };
}

export default class CategoriesController {
  async list() {
    try {
      return ok(await dataAccess.list());
    } catch (error) {
      return serverError(error);
    }
  }

  async get(slug) {
    try {
      const category = await dataAccess.findActiveByIdOrSlug(slug);
      return category ? ok(category) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }

  async listForAdmin() {
    try {
      return ok(await dataAccess.list(true));
    } catch (error) {
      return serverError(error);
    }
  }

  async create(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Corpo da requisição inválido.');
    if (!requiredText(body.name, 80)) return invalid('Nome de categoria inválido.');
    const { subcategories, error } = normalizeSubcategories(body.subcategories ?? []);
    if (error) return invalid(error);
    const name = body.name.trim();
    const slug = makeSlug(name);
    if (!slug) return invalid('Nome de categoria inválido.');

    try {
      const category = await dataAccess.create(createCategoryDocument({
        name,
        slug,
        subcategories
      }));
      return { success: true, statusCode: 201, body: category };
    } catch (error) {
      if (error.code === 11000) return { success: false, statusCode: 409, body: 'Categoria já cadastrada.' };
      return serverError(error);
    }
  }

  async update(id, body) {
    if (!isObjectId(id)) return invalid('ID de categoria inválido.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return invalid('Corpo da requisição inválido.');
    }
    if (body.name === undefined && body.subcategories === undefined) {
      return invalid('Informe o nome ou as subcategorias para atualizar.');
    }
    const updates = {};
    if (body.name !== undefined) {
      if (!requiredText(body.name, 80)) return invalid('Nome de categoria inválido.');
      updates.name = body.name.trim();
      updates.slug = makeSlug(updates.name);
      if (!updates.slug) return invalid('Nome de categoria inválido.');
    }
    if (body.subcategories !== undefined) {
      const result = normalizeSubcategories(body.subcategories);
      if (result.error) return invalid(result.error);
      updates.subcategories = result.subcategories;
    }

    try {
      const category = await dataAccess.update(id, createCategoryUpdates(updates));
      return category ? ok(category) : notFound();
    } catch (error) {
      if (error.code === 11000) return { success: false, statusCode: 409, body: 'Já existe uma categoria com esse nome.' };
      return serverError(error);
    }
  }

  async updateStatus(id, body) {
    if (!isObjectId(id)) return invalid('ID de categoria inválido.');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.active !== 'boolean') {
      return invalid('Informe active como booleano.');
    }
    try {
      const category = await dataAccess.updateStatus(id, body.active);
      return category ? ok(category) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }

  async delete(id) {
    if (!isObjectId(id)) return invalid('ID de categoria inválido.');
    try {
      const category = await dataAccess.deactivate(id);
      return category ? ok({ message: 'Categoria desativada com sucesso.', category }) : notFound();
    } catch (error) {
      return serverError(error);
    }
  }
}
