import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, Input, Modal } from '../../components/index.js';
import './ProductDetails.css';

const REPORT_REASONS = [
  'Produto proibido',
  'Informações falsas',
  'Publicação duplicada',
  'Conteúdo inadequado',
  'Outros'
];

function readProduct(response) {
  const product = response?.body;
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new Error('A API retornou os dados do produto em formato inesperado.');
  }
  return product;
}

function getId(value) {
  if (typeof value === 'string') return value;
  return value?._id?.toString?.() || value?.id?.toString?.() || '';
}

function getPhotos(product) {
  const photos = product.photos || product.fotografias || [];
  if (!Array.isArray(photos)) return [];
  return photos
    .map((photo) => (typeof photo === 'string' ? photo : photo?.url))
    .filter((url) => typeof url === 'string' && url.trim());
}

function getProductName(product) {
  return product.name || product.nome || 'Produto';
}

function getStatus(product) {
  return product.status || product.statusDoacao || '';
}

function getLocation(product) {
  return product.neighborhood || product.bairro || '';
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

export default function ProductDetails() {
  const { id } = useParams();
  const { token, signOut, openLogin } = useAuth();
  const [product, setProduct] = useState(null);
  const [productState, setProductState] = useState({ loading: true, error: '', notFound: false });
  const [categoryName, setCategoryName] = useState('');
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [activePhoto, setActivePhoto] = useState(0);
  const [favoriteState, setFavoriteState] = useState({ loading: false, loaded: false, error: '' });
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteActionLoading, setFavoriteActionLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportState, setReportState] = useState({ loading: false, error: '', success: '' });
  const reportSubmitting = useRef(false);
  const [reloadProduct, setReloadProduct] = useState(0);

  const photos = useMemo(() => (product ? getPhotos(product) : []), [product]);
  const productId = product ? getId(product._id || product.id) : '';
  const productCategoryId = product ? getId(product.categoryId || product.category?._id) : '';
  const directCategoryName = product?.category?.name
    || product?.categoryName
    || (typeof product?.category === 'string' ? product.category : '');
  const status = product ? getStatus(product) : '';
  const statusLabel = {
    disponivel: 'Disponível',
    reservado: 'Reservado',
    doado: 'Doado'
  }[status] || (status || 'Status não informado');
  const isAvailable = status === 'disponivel';

  useEffect(() => {
    let active = true;
    setProduct(null);
    setProductState({ loading: true, error: '', notFound: false });
    setCategoryName('');
    setCategoryError('');
    setActivePhoto(0);

    api.get(`produtos/${encodeURIComponent(id || '')}`)
      .then((response) => {
        const value = readProduct(response);
        if (!active) return;
        setProduct(value);
        setProductState({ loading: false, error: '', notFound: false });
      })
      .catch((error) => {
        if (!active) return;
        setProduct(null);
        setProductState({
          loading: false,
          error: isNotFound(error) ? '' : getErrorMessage(error, 'Não foi possível carregar o produto.'),
          notFound: isNotFound(error)
        });
      });

    return () => {
      active = false;
    };
  }, [id, reloadProduct]);

  useEffect(() => {
    let active = true;
    if (!product) return undefined;
    if (directCategoryName) {
      setCategoryName(directCategoryName);
      setCategoryLoading(false);
      setCategoryError('');
      return undefined;
    }
    if (!productCategoryId) {
      setCategoryName('');
      setCategoryLoading(false);
      setCategoryError('');
      return undefined;
    }

    setCategoryLoading(true);
    setCategoryError('');
    api.get(`categorias/${encodeURIComponent(productCategoryId)}`)
      .then((response) => {
        const value = response?.body;
        if (!value || typeof value.name !== 'string') {
          throw new Error('A API retornou a categoria em formato inesperado.');
        }
        if (!active) return;
        setCategoryName(value.name);
      })
      .catch((error) => {
        if (!active) return;
        setCategoryName('');
        setCategoryError(getErrorMessage(error, 'Não foi possível carregar a categoria.'));
      })
      .finally(() => {
        if (active) setCategoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [directCategoryName, product, productCategoryId]);

  useEffect(() => {
    let active = true;
    if (!token || !productId) {
      setFavoriteState({ loading: false, loaded: false, error: '' });
      setIsFavorite(false);
      return undefined;
    }

    setFavoriteState({ loading: true, loaded: false, error: '' });
    api.get('favoritos', { token })
      .then((response) => {
        if (!Array.isArray(response?.body)) {
          throw new Error('A API retornou os favoritos em formato inesperado.');
        }
        const found = response.body.some((favorite) =>
          getId(favorite.productId || favorite.produtoId || favorite.product?._id) === productId
        );
        if (!active) return;
        setIsFavorite(found);
        setFavoriteState({ loading: false, loaded: true, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setFavoriteState({
          loading: false,
          loaded: false,
          error: getErrorMessage(error, 'Não foi possível carregar seus favoritos.')
        });
      });

    return () => {
      active = false;
    };
  }, [productId, token]);

  function requireAuthentication() {
    openLogin();
  }

  async function toggleFavorite() {
    if (!token) {
      requireAuthentication();
      return;
    }
    if (!productId || favoriteActionLoading) return;

    setFavoriteActionLoading(true);
    setFavoriteState((current) => ({ ...current, error: '' }));
    try {
      if (isFavorite) {
        await api.delete(`favoritos/${encodeURIComponent(productId)}`, { token });
        setIsFavorite(false);
      } else {
        await api.post('favoritos', { produtoId: productId }, { token });
        setIsFavorite(true);
      }
    } catch (error) {
      setFavoriteState((current) => ({
        ...current,
        error: getErrorMessage(error, 'Não foi possível atualizar seus favoritos.')
      }));
    } finally {
      setFavoriteActionLoading(false);
    }
  }

  function openReport() {
    if (!token) {
      requireAuthentication();
      return;
    }
    setReportReason('');
    setReportDescription('');
    setReportState({ loading: false, error: '', success: '' });
    setReportOpen(true);
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!reportReason || reportSubmitting.current || !productId) return;

    reportSubmitting.current = true;
    setReportState({ loading: true, error: '', success: '' });
    try {
      const body = {
        produtoId: productId,
        motivo: reportReason,
        ...(reportDescription.trim() ? { descricao: reportDescription.trim() } : {})
      };
      const response = await api.post('denuncias', body, { token });
      setReportState({
        loading: false,
        error: '',
        success: response?.body?.detail || 'Sua denúncia foi registrada com sucesso.'
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        openLogin();
        setReportState({
          loading: false,
          error: 'Sua sessão expirou. Entre novamente para enviar a denúncia.',
          success: ''
        });
      } else {
        setReportState({
          loading: false,
          error: error instanceof ApiError && error.status === 403
            ? 'Você não tem permissão para enviar esta denúncia.'
            : getErrorMessage(error, 'Não foi possível enviar a denúncia.'),
          success: ''
        });
      }
    } finally {
      reportSubmitting.current = false;
    }
  }

  function closeReport() {
    if (reportState.loading) return;
    setReportOpen(false);
    setReportState({ loading: false, error: '', success: '' });
  }

  return (
    <div className="product-details-page">
      <Header />
      <main className="product-details">
        <nav className="product-details__breadcrumb" aria-label="Navegação estrutural">
          <Link to="/explorar">Explorar doações</Link>
          <span aria-hidden="true">/</span>
          <span>Detalhes do produto</span>
        </nav>

        {productState.loading ? (
          <div className="product-details__state" role="status" aria-live="polite">
            <span className="product-details__spinner" aria-hidden="true" />
            <p>Carregando produto…</p>
          </div>
        ) : productState.notFound ? (
          <div className="product-details__state" role="status">
            <h1>Produto não encontrado</h1>
            <p>Esta publicação não existe ou não está mais disponível para visualização.</p>
            <Button as={Link} to="/explorar" variant="outline">Voltar para explorar</Button>
          </div>
        ) : productState.error ? (
          <div className="product-details__state product-details__state--error" role="alert">
            <h1>Não foi possível carregar o produto</h1>
            <p>{productState.error}</p>
            <Button variant="outline" onClick={() => setReloadProduct((current) => current + 1)}>
              Tentar novamente
            </Button>
          </div>
        ) : product ? (
          <article className="product-details__layout">
            <section className="product-details__gallery" aria-label="Galeria de imagens do produto">
              <div className="product-details__main-image">
                {photos.length ? (
                  <img src={photos[activePhoto]} alt={`${getProductName(product)} - imagem ${activePhoto + 1}`} />
                ) : (
                  <span>Sem fotografia disponível</span>
                )}
              </div>
              {photos.length > 1 && (
                <div className="product-details__thumbnails" aria-label="Escolher imagem">
                  {photos.map((photo, index) => (
                    <button
                      key={`${photo}-${index}`}
                      type="button"
                      className={`product-details__thumbnail${index === activePhoto ? ' is-active' : ''}`}
                      aria-label={`Exibir imagem ${index + 1}`}
                      aria-pressed={index === activePhoto}
                      onClick={() => setActivePhoto(index)}
                    >
                      <img src={photo} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="product-details__info">
              <div className="product-details__title-row">
                <div>
                  <span className={`product-details__status${isAvailable ? ' product-details__status--available' : ''}`}>
                    {statusLabel}
                  </span>
                  <h1>{getProductName(product)}</h1>
                </div>
                <Button
                  variant="outline"
                  className="product-details__favorite"
                  aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                  aria-pressed={isFavorite}
                  disabled={favoriteState.loading || favoriteActionLoading}
                  loading={favoriteActionLoading}
                  onClick={toggleFavorite}
                >
                  {isFavorite ? '♥ Favoritado' : '♡ Favoritar'}
                </Button>
              </div>

              <p className="product-details__category">
                {categoryLoading ? 'Carregando categoria…' : (categoryName || (categoryError ? 'Categoria indisponível' : 'Categoria não informada'))}
                {(product.subcategory || product.subcategoria) && (
                  <> <span aria-hidden="true">·</span> {product.subcategory || product.subcategoria}</>
                )}
              </p>

              <section className="product-details__section">
                <h2>Descrição</h2>
                <p className="product-details__description">
                  {product.description || product.descricao || 'O doador não informou uma descrição para este produto.'}
                </p>
              </section>

              <dl className="product-details__facts">
                {(product.condition || product.conservacao) && (
                  <div>
                    <dt>Estado de conservação</dt>
                    <dd>{product.condition || product.conservacao}</dd>
                  </div>
                )}
                {getLocation(product) && (
                  <div>
                    <dt>Bairro ou região</dt>
                    <dd>{getLocation(product)}</dd>
                  </div>
                )}
                <div>
                  <dt>Disponibilidade</dt>
                  <dd>{statusLabel}</dd>
                </div>
              </dl>

              <section className="product-details__donor">
                <h2>Sobre o doador</h2>
                <p>
                  A API de detalhes não disponibiliza informações públicas do doador.
                </p>
              </section>

              <div className="product-details__actions">
                <Button
                  className="product-details__contact"
                  variant="primary"
                  disabled
                  title="A API não oferece um meio de contato público para esta publicação."
                >
                  Contato não disponível
                </Button>
                <p className="product-details__contact-note">
                  A API não oferece um meio de contato público autorizado para este produto.
                </p>
                {favoriteState.error && (
                  <p className="product-details__feedback product-details__feedback--error" role="alert">
                    {favoriteState.error}
                  </p>
                )}
                {categoryError && (
                  <p className="product-details__feedback" role="status">{categoryError}</p>
                )}
                <Button variant="outline" onClick={openReport}>Denunciar publicação</Button>
              </div>
            </section>
          </article>
        ) : null}
      </main>
      <Modal
        open={reportOpen}
        onClose={closeReport}
        title={reportState.success ? 'Denúncia recebida' : 'Denunciar publicação'}
        description={reportState.success
          ? 'Obrigado por ajudar a manter a comunidade segura.'
          : 'Selecione o motivo e, se necessário, conte mais detalhes.'}
        className="product-report-modal"
      >
        {reportState.success ? (
          <div className="product-report__success" role="status">
            <p>{reportState.success}</p>
            <Button onClick={closeReport}>Concluir</Button>
          </div>
        ) : (
          <form className="product-report" onSubmit={submitReport}>
            <div className="product-report__product">
              <span>Publicação denunciada</span>
              <strong>{product ? getProductName(product) : 'Publicação'}</strong>
              {productId && <small>Identificação: {productId}</small>}
            </div>
            <label className="product-report__field">
              <span>Motivo da denúncia</span>
              <select
                value={reportReason}
                onChange={(event) => {
                  setReportReason(event.target.value);
                  setReportState((current) => ({ ...current, error: '' }));
                }}
                required
                disabled={reportState.loading}
              >
                <option value="">Selecione um motivo</option>
                {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <Input
              label="Descrição (opcional)"
              as="textarea"
              maxLength={1000}
              value={reportDescription}
              onChange={(event) => setReportDescription(event.target.value)}
              disabled={reportState.loading}
            />
            {reportState.error && <p className="product-report__error" role="alert">{reportState.error}</p>}
            <div className="product-report__actions">
              <Button type="submit" loading={reportState.loading} disabled={!reportReason}>
                Enviar denúncia
              </Button>
              <Button type="button" variant="outline" onClick={closeReport} disabled={reportState.loading}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
