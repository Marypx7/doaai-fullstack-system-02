import { useEffect, useMemo, useState } from 'react';
import { Button, Header, Input, ProductCard } from '../../components/index.js';
import { api } from '../../services/api.js';
import './Explore.css';

const PAGE_SIZE = 12;

function readProductList(response) {
  const body = response?.body;
  if (!body || !Array.isArray(body.items) || !Number.isFinite(body.total)) {
    throw new Error('A API retornou uma lista de produtos em formato inesperado.');
  }
  return body;
}

function readCategories(response) {
  if (!Array.isArray(response?.body)) {
    throw new Error('A API retornou uma lista de categorias em formato inesperado.');
  }
  return response.body.filter((category) => category?.active !== false);
}

export default function Explore() {
  const [categories, setCategories] = useState([]);
  const [categoryState, setCategoryState] = useState({ loading: true, error: '' });
  const [products, setProducts] = useState([]);
  const [result, setResult] = useState({ total: 0, pages: 0 });
  const [productState, setProductState] = useState({ loading: true, error: '' });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [reloadCategories, setReloadCategories] = useState(0);
  const [reloadProducts, setReloadProducts] = useState(0);

  const selectedCategory = useMemo(
    () => categories.find((item) => item.slug === category || item._id === category),
    [categories, category]
  );
  const subcategories = selectedCategory?.subcategories || [];
  const categoryNames = useMemo(
    () => new Map(categories.map((item) => [item._id, item.name])),
    [categories]
  );

  useEffect(() => {
    let active = true;
    setCategoryState({ loading: true, error: '' });
    api.get('categorias')
      .then((response) => {
        const values = readCategories(response);
        if (!active) return;
        setCategories(values);
        setCategoryState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setCategories([]);
        setCategoryState({ loading: false, error: error.message || 'Não foi possível carregar as categorias.' });
      });

    return () => {
      active = false;
    };
  }, [reloadCategories]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      status: 'disponivel',
      page: String(page),
      limit: String(PAGE_SIZE),
      sort
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (category) params.set('category', category);
    if (subcategory) params.set('subcategory', subcategory);
    if (neighborhood.trim()) params.set('neighborhood', neighborhood.trim());

    setProductState({ loading: true, error: '' });
    api.get(`produtos?${params.toString()}`)
      .then((response) => {
        const data = readProductList(response);
        if (!active) return;
        setProducts(data.items.filter((product) => (product.status || product.statusDoacao) === 'disponivel'));
        setResult({
          total: data.total,
          pages: Number.isFinite(data.pages) ? data.pages : Math.ceil(data.total / PAGE_SIZE)
        });
        setProductState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setProducts([]);
        setResult({ total: 0, pages: 0 });
        setProductState({ loading: false, error: error.message || 'Não foi possível carregar as doações.' });
      });

    return () => {
      active = false;
    };
  }, [category, debouncedSearch, neighborhood, page, reloadProducts, sort, subcategory]);

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setSubcategory('');
    setNeighborhood('');
    setSort('recent');
    setPage(1);
  }

  function handleCategoryChange(event) {
    setCategory(event.target.value);
    setSubcategory('');
    setPage(1);
  }

  function updateFilter(setter) {
    return (event) => {
      setter(event.target.value);
      setPage(1);
    };
  }

  return (
    <div className="explore-page">
      <Header />
      <main>
        <section className="explore-intro" aria-labelledby="explore-title">
          <span className="explore-eyebrow">Encontre algo que pode ganhar um novo ciclo</span>
          <h1 id="explore-title">Explorar Doações</h1>
          <p>Pesquise itens disponíveis e descubra oportunidades de doação perto de você.</p>
        </section>

        <section className="explore-content" aria-label="Pesquisa e resultados de doações">
          <form className="explore-filters" onSubmit={(event) => event.preventDefault()}>
            <Input
              label="Pesquisar doações"
              type="search"
              name="search"
              placeholder="Busque por nome ou descrição"
              maxLength={100}
              value={search}
              onChange={updateFilter(setSearch)}
            />

            <label className="explore-select-field">
              <span>Categoria</span>
              <select value={category} onChange={handleCategoryChange} disabled={categoryState.loading}>
                <option value="">Todas as categorias</option>
                {categories.map((item) => (
                  <option key={item._id || item.slug} value={item.slug || item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="explore-select-field">
              <span>Subcategoria</span>
              <select
                value={subcategory}
                onChange={updateFilter(setSubcategory)}
                disabled={!category || categoryState.loading}
              >
                <option value="">Todas as subcategorias</option>
                {subcategories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <Input
              label="Bairro ou região"
              name="neighborhood"
              placeholder="Ex.: Centro"
              maxLength={120}
              value={neighborhood}
              onChange={updateFilter(setNeighborhood)}
            />

            <label className="explore-select-field">
              <span>Ordenar por</span>
              <select value={sort} onChange={updateFilter(setSort)}>
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigas</option>
              </select>
            </label>

            <Button type="button" variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </form>

          {categoryState.error && (
            <div className="explore-notice explore-notice--error" role="alert">
              <p>{categoryState.error}</p>
              <Button
                variant="outline"
                onClick={() => setReloadCategories((current) => current + 1)}
              >
                Tentar carregar categorias novamente
              </Button>
            </div>
          )}

          <div className="explore-results-heading">
            <h2>Doações disponíveis</h2>
            {!productState.loading && !productState.error && (
              <span>{result.total} {result.total === 1 ? 'item encontrado' : 'itens encontrados'}</span>
            )}
          </div>

          {productState.loading ? (
            <div className="explore-state" role="status" aria-live="polite">
              <span className="explore-spinner" aria-hidden="true" />
              <p>Carregando doações…</p>
            </div>
          ) : productState.error ? (
            <div className="explore-state explore-state--error" role="alert">
              <p>{productState.error}</p>
              <Button variant="outline" onClick={() => setReloadProducts((current) => current + 1)}>
                Tentar novamente
              </Button>
            </div>
          ) : products.length === 0 ? (
            <div className="explore-state">
              <span className="explore-state__empty-title">Nenhuma doação encontrada</span>
              <p>Tente alterar ou limpar os filtros para ver outras oportunidades.</p>
              <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button>
            </div>
          ) : (
            <>
              <div className="explore-products">
                {products.map((product) => {
                  const productCategoryId = typeof product.categoryId === 'string'
                    ? product.categoryId
                    : product.categoryId?.toString?.();
                  const productCategory = product.category?.name
                    || product.categoryName
                    || categoryNames.get(productCategoryId)
                    || product.subcategory;
                  return (
                    <ProductCard
                      key={product._id || product.id}
                      product={{ ...product, categoryName: productCategory }}
                      detailsTo={`/produtos/${product._id || product.id}`}
                    />
                  );
                })}
              </div>

              {result.pages > 1 && (
                <nav className="explore-pagination" aria-label="Paginação dos resultados">
                  <Button
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Anterior
                  </Button>
                  <span>Página {page} de {result.pages}</span>
                  <Button
                    variant="outline"
                    disabled={page >= result.pages}
                    onClick={() => setPage((current) => Math.min(result.pages, current + 1))}
                  >
                    Próxima
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
