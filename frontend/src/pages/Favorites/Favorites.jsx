import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, ProductCard } from '../../components/index.js';
import './Favorites.css';

function getId(value) {
  if (typeof value === 'string') return value;
  return value?._id?.toString?.() || value?.id?.toString?.() || value?.toString?.() || '';
}

function readFavorites(response) {
  if (!Array.isArray(response?.body)) {
    throw new Error('A API retornou os favoritos em formato inesperado.');
  }
  return response.body
    .map((favorite) => {
      const product = Array.isArray(favorite.product) ? favorite.product[0] : favorite.product;
      return {
        id: getId(favorite.productId || favorite.produtoId || product?._id),
        product
      };
    })
    .filter((favorite) => favorite.id && favorite.product && typeof favorite.product === 'object');
}

function readCategories(response) {
  if (!Array.isArray(response?.body)) {
    throw new Error('A API retornou uma lista de categorias em formato inesperado.');
  }
  return response.body.filter((category) => category?.active !== false);
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Favorites() {
  const { token, signOut, openLogin } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [favoriteState, setFavoriteState] = useState({ loading: true, error: '' });
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [reloadCategories, setReloadCategories] = useState(0);
  const [removingId, setRemovingId] = useState('');
  const [removeError, setRemoveError] = useState('');

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [getId(category._id), category.name])),
    [categories]
  );

  useEffect(() => {
    let active = true;
    if (!token) {
      setFavorites([]);
      setFavoriteState({ loading: false, error: '' });
      return undefined;
    }

    setFavoriteState({ loading: true, error: '' });
    api.get('favoritos', { token })
      .then((response) => {
        const values = readFavorites(response);
        if (!active) return;
        setFavorites(values);
        setFavoriteState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          signOut();
          openLogin();
          setFavorites([]);
          setFavoriteState({
            loading: false,
            error: 'Sua sessão expirou. Entre novamente para ver seus favoritos.'
          });
          return;
        }
        setFavorites([]);
        setFavoriteState({
          loading: false,
          error: getErrorMessage(error, 'Não foi possível carregar seus favoritos.')
        });
      });

    return () => {
      active = false;
    };
  }, [openLogin, reloadKey, signOut, token]);

  useEffect(() => {
    let active = true;
    api.get('categorias')
      .then((response) => {
        const values = readCategories(response);
        if (active) {
          setCategories(values);
          setCategoryError('');
        }
      })
      .catch((error) => {
        if (active) {
          setCategories([]);
          setCategoryError(getErrorMessage(error, 'Não foi possível carregar as categorias.'));
        }
      });
    return () => {
      active = false;
    };
  }, [reloadCategories]);

  async function removeFavorite(productId) {
    if (!token || !productId || removingId) return;
    setRemovingId(productId);
    setRemoveError('');
    try {
      await api.delete(`favoritos/${encodeURIComponent(productId)}`, { token });
      setFavorites((current) => current.filter((favorite) => favorite.id !== productId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        openLogin();
        setRemoveError('Sua sessão expirou. Entre novamente para gerenciar seus favoritos.');
      } else if (error instanceof ApiError && error.status === 403) {
        setRemoveError('Você não tem permissão para alterar estes favoritos.');
      } else {
        setRemoveError(getErrorMessage(error, 'Não foi possível remover este favorito.'));
      }
    } finally {
      setRemovingId('');
    }
  }

  return (
    <div className="favorites-page">
      <Header />
      <main className="favorites">
        <header className="favorites__intro">
          <span className="favorites__eyebrow">Itens que você salvou</span>
          <h1>Meus Favoritos</h1>
          <p>Encontre novamente as doações que chamaram sua atenção.</p>
        </header>

        {!token ? (
          <section className="favorites__state">
            <h2>Entre para acessar seus favoritos</h2>
            <p>Seus produtos favoritos ficam disponíveis na sua conta.</p>
            <Button onClick={openLogin}>Entrar</Button>
          </section>
        ) : favoriteState.loading ? (
          <section className="favorites__state" role="status" aria-live="polite">
            <span className="favorites__spinner" aria-hidden="true" />
            <p>Carregando seus favoritos…</p>
          </section>
        ) : favoriteState.error ? (
          <section className="favorites__state favorites__state--error" role="alert">
            <p>{favoriteState.error}</p>
            <Button variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
              Tentar novamente
            </Button>
          </section>
        ) : favorites.length === 0 ? (
          <section className="favorites__state">
            <h2>Você ainda não tem favoritos.</h2>
            <p>Explore as doações disponíveis e salve os produtos que mais chamarem sua atenção.</p>
            <Button as={Link} to="/explorar">Explorar Doações</Button>
          </section>
        ) : (
          <>
            {categoryError && (
              <div className="favorites__notice" role="alert">
                <p>{categoryError}</p>
                <Button variant="outline" onClick={() => setReloadCategories((current) => current + 1)}>
                  Tentar carregar categorias novamente
                </Button>
              </div>
            )}
            {removeError && (
              <div className="favorites__notice favorites__notice--error" role="alert">
                <p>{removeError}</p>
              </div>
            )}
            <section className="favorites__grid" aria-label="Produtos favoritos">
              {favorites.map(({ id, product }) => {
                const categoryId = getId(product.categoryId || product.category?._id);
                const directCategory = product.category?.name
                  || product.categoryName
                  || (typeof product.category === 'string' ? product.category : '');
                const categoryName = directCategory || categoryNames.get(categoryId) || '';
                const cardProduct = {
                  ...product,
                  category: categoryName,
                  categoryName
                };

                return (
                  <article className="favorites__card" key={id}>
                    <ProductCard
                      product={cardProduct}
                      detailsTo={`/produtos/${encodeURIComponent(id)}`}
                    />
                    <Button
                      variant="outline"
                      className="favorites__remove"
                      onClick={() => removeFavorite(id)}
                      disabled={Boolean(removingId)}
                      loading={removingId === id}
                      aria-label={`Remover ${product.name || product.nome || 'produto'} dos favoritos`}
                    >
                      Remover dos favoritos
                    </Button>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
