export const CATEGORIES_COLLECTION = 'categories';

export const DEFAULT_CATEGORIES = [
  { name: 'Móveis', slug: 'moveis', subcategories: ['Cadeiras', 'Mesas', 'Sofás', 'Armários', 'Camas'] },
  { name: 'Roupas e acessórios', slug: 'roupas-e-acessorios', subcategories: ['Roupas', 'Calçados', 'Bolsas', 'Acessórios'] },
  { name: 'Eletrônicos', slug: 'eletronicos', subcategories: ['Celulares', 'Computadores', 'Eletrodomésticos', 'Acessórios'] },
  { name: 'Livros', slug: 'livros', subcategories: ['Literatura', 'Didáticos', 'Infantis', 'Outros'] },
  { name: 'Brinquedos', slug: 'brinquedos', subcategories: ['Jogos', 'Bonecas e bonecos', 'Educativos', 'Outros'] },
  { name: 'Utilidades domésticas', slug: 'utilidades-domesticas', subcategories: ['Cozinha', 'Decoração', 'Organização', 'Outros'] },
  { name: 'Materiais escolares', slug: 'materiais-escolares', subcategories: ['Cadernos', 'Escrita', 'Mochilas', 'Outros'] },
  { name: 'Artigos infantis', slug: 'artigos-infantis', subcategories: ['Roupas', 'Alimentação', 'Passeio', 'Outros'] },
  { name: 'Outros', slug: 'outros', subcategories: ['Outros'] }
];

export function createCategoryDocument({ name, slug, subcategories = [] }) {
  const now = new Date();
  return {
    name,
    slug,
    subcategories,
    active: true,
    createdAt: now,
    updatedAt: now
  };
}

export function createCategoryUpdates({ name, slug, subcategories }) {
  const updates = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (slug !== undefined) updates.slug = slug;
  if (subcategories !== undefined) updates.subcategories = subcategories;
  return updates;
}
