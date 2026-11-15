import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, Input, Modal, ProductCard } from '../../components/index.js';
import './MyDonations.css';

const PAGE_SIZE = 12;
const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const STATUS_OPTIONS = [
  { value: 'disponivel', label: 'Disponível' },
  { value: 'reservado', label: 'Reservado' },
  { value: 'doado', label: 'Doado' }
];

const EMPTY_EDIT = {
  product: null,
  name: '',
  categoryId: '',
  subcategory: '',
  condition: '',
  description: '',
  neighborhood: ''
};

function getId(value) {
  if (typeof value === 'string') return value;
  return value?._id?.toString?.() || value?.id?.toString?.() || '';
}

function getProductId(product) {
  return getId(product?._id || product?.id);
}

function getProductStatus(product) {
  return product.status || product.statusDoacao || '';
}

function getProductPhotos(product) {
  const photos = product.photos || product.fotografias || [];
  return Array.isArray(photos) ? photos : [];
}

function getPhotoUrl(photo) {
  return typeof photo === 'string' ? photo : photo?.url || '';
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

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

function formatPublicationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
}

export default function MyDonations() {
  const { token, signOut, openLogin } = useAuth();
  const [products, setProducts] = useState([]);
  const [result, setResult] = useState({ total: 0, pages: 0 });
  const [productState, setProductState] = useState({ loading: true, error: '' });
  const [categories, setCategories] = useState([]);
  const [categoryState, setCategoryState] = useState({ loading: true, error: '' });
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [reloadCategories, setReloadCategories] = useState(0);
  const [editing, setEditing] = useState(EMPTY_EDIT);
  const [editSubcategories, setEditSubcategories] = useState([]);
  const [editCategoryState, setEditCategoryState] = useState({ loading: false, error: '' });
  const [editFiles, setEditFiles] = useState([]);
  const editFilesRef = useRef(editFiles);
  const [reloadEditCategory, setReloadEditCategory] = useState(0);
  const [removedPhotoIds, setRemovedPhotoIds] = useState([]);
  const [editPhotoError, setEditPhotoError] = useState('');
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const editLoadingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [busyProducts, setBusyProducts] = useState({});
  const [productErrors, setProductErrors] = useState({});

  editFilesRef.current = editFiles;

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [getId(category._id), category.name])),
    [categories]
  );
  const originalPhotos = editing.product ? getProductPhotos(editing.product) : [];
  const retainedPhotos = originalPhotos.filter((photo) => !removedPhotoIds.includes(photo?.publicId));
  const maximumNewPhotos = Math.max(0, MAX_PHOTOS - retainedPhotos.length);

  function handleUnauthorized(error) {
    if (error instanceof ApiError && error.status === 401) {
      signOut();
      openLogin();
      return true;
    }
    return false;
  }

  useEffect(() => {
    let active = true;
    if (!token) {
      setProducts([]);
      setResult({ total: 0, pages: 0 });
      setProductState({ loading: false, error: '' });
      return undefined;
    }

    setProductState({ loading: true, error: '' });
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort: 'recent'
    });
    if (statusFilter) params.set('status', statusFilter);

    api.get(`usuarios/me/produtos?${params.toString()}`, { token })
      .then((response) => {
        const data = readProductList(response);
        if (!active) return;
        const pages = Number.isFinite(data.pages) ? data.pages : Math.ceil(data.total / PAGE_SIZE);
        if (page > 1 && pages < page) {
          setPage(Math.max(1, pages));
          return;
        }
        setProducts(data.items);
        setResult({
          total: data.total,
          pages
        });
        setProductState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        if (handleUnauthorized(error)) {
          setProducts([]);
          setResult({ total: 0, pages: 0 });
          setProductState({ loading: false, error: 'Sua sessão expirou. Entre novamente para ver suas doações.' });
          return;
        }
        setProducts([]);
        setResult({ total: 0, pages: 0 });
        setProductState({
          loading: false,
          error: getErrorMessage(error, 'Não foi possível carregar suas doações.')
        });
      });

    return () => {
      active = false;
    };
  }, [page, reloadKey, signOut, statusFilter, token]);

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
        setCategoryState({
          loading: false,
          error: getErrorMessage(error, 'Não foi possível carregar as categorias.')
        });
      });
    return () => {
      active = false;
    };
  }, [reloadCategories]);

  useEffect(() => {
    let active = true;
    if (!editing.categoryId) {
      setEditSubcategories([]);
      setEditCategoryState({ loading: false, error: '' });
      return undefined;
    }

    setEditCategoryState({ loading: true, error: '' });
    api.get(`categorias/${encodeURIComponent(editing.categoryId)}`)
      .then((response) => {
        if (!Array.isArray(response?.body?.subcategories)) {
          throw new Error('A API retornou as subcategorias em formato inesperado.');
        }
        if (!active) return;
        setEditSubcategories(response.body.subcategories);
        setEditCategoryState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setEditSubcategories([]);
        setEditCategoryState({
          loading: false,
          error: getErrorMessage(error, 'Não foi possível carregar as subcategorias.')
        });
      });
    return () => {
      active = false;
    };
  }, [editing.categoryId, reloadEditCategory]);

  useEffect(() => () => {
    editFilesRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
  }, []);

  function openEdit(product) {
    const productCategoryId = getId(product.categoryId || product.category?._id);
    setEditing({
      product,
      name: product.name || product.nome || '',
      categoryId: productCategoryId,
      subcategory: product.subcategory || product.subcategoria || '',
      condition: product.condition || product.conservacao || '',
      description: product.description || product.descricao || '',
      neighborhood: product.neighborhood || product.bairro || ''
    });
    setEditFiles([]);
    setRemovedPhotoIds([]);
    setEditPhotoError('');
    setEditError('');
  }

  function closeEdit() {
    if (editLoadingRef.current) return;
    editFiles.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setEditing(EMPTY_EDIT);
    setEditFiles([]);
    setRemovedPhotoIds([]);
    setEditPhotoError('');
    setEditError('');
  }

  function updateEditField(field, value) {
    setEditing((current) => ({ ...current, [field]: value }));
    setEditError('');
  }

  function addEditPhotos(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    setEditPhotoError('');
    if (!selected.length) return;

    if (selected.length + editFiles.length > maximumNewPhotos) {
      setEditPhotoError(`Você pode adicionar no máximo ${maximumNewPhotos} nova(s) fotografia(s).`);
      return;
    }

    const errors = [];
    const valid = [];
    selected.forEach((file) => {
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        errors.push(`${file.name}: formato inválido. Use JPEG, PNG ou WEBP.`);
      } else if (file.size > MAX_PHOTO_SIZE) {
        errors.push(`${file.name}: o arquivo excede o limite de 5 MB.`);
      } else {
        valid.push(file);
      }
    });
    if (valid.length + editFiles.length > maximumNewPhotos) {
      setEditPhotoError(`Você pode adicionar no máximo ${maximumNewPhotos} nova(s) fotografia(s).`);
      return;
    }
    if (errors.length) setEditPhotoError(errors.join(' '));
    setEditFiles((current) => [
      ...current,
      ...valid.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        preview: URL.createObjectURL(file)
      }))
    ]);
  }

  function removeEditFile(fileId) {
    const removed = editFiles.find((item) => item.id === fileId);
    if (removed) URL.revokeObjectURL(removed.preview);
    setEditFiles((current) => current.filter((item) => item.id !== fileId));
    setEditPhotoError('');
  }

  function validateEdit() {
    const errors = [];
    if (!editing.name.trim()) errors.push('Informe o nome do produto.');
    else if (editing.name.trim().length > 120) errors.push('O nome deve ter até 120 caracteres.');
    if (!editing.categoryId) errors.push('Selecione uma categoria.');
    if (!editing.subcategory) errors.push('Selecione uma subcategoria.');
    if (!editing.condition.trim()) errors.push('Informe o estado de conservação.');
    else if (editing.condition.trim().length > 120) errors.push('O estado de conservação deve ter até 120 caracteres.');
    if (!editing.description.trim()) errors.push('Informe a descrição.');
    else if (editing.description.trim().length > 2000) errors.push('A descrição deve ter até 2000 caracteres.');
    if (!editing.neighborhood.trim()) errors.push('Informe o bairro ou região.');
    else if (editing.neighborhood.trim().length > 120) errors.push('O bairro ou região deve ter até 120 caracteres.');
    if (editCategoryState.loading || editCategoryState.error) errors.push('Aguarde o carregamento das subcategorias.');
    if (errors.length) {
      setEditError(errors.join(' '));
      return false;
    }
    return true;
  }

  async function submitEdit(event) {
    event.preventDefault();
    if (editLoadingRef.current || !editing.product || !validateEdit()) return;

    editLoadingRef.current = true;
    setEditLoading(true);
    setEditError('');

    const productId = getProductId(editing.product);
    const removedPhotos = removedPhotoIds.filter((publicId) =>
      originalPhotos.some((photo) => photo?.publicId === publicId)
    );
    const valuesToSend = {
      name: editing.name.trim(),
      categoryId: editing.categoryId,
      subcategory: editing.subcategory,
      condition: editing.condition.trim(),
      description: editing.description.trim(),
      neighborhood: editing.neighborhood.trim()
    };

    let body = valuesToSend;
    if (editFiles.length || removedPhotos.length) {
      const formData = new FormData();
      Object.entries(valuesToSend).forEach(([key, value]) => formData.append(key, value));
      if (removedPhotos.length) formData.append('removePhotos', JSON.stringify(removedPhotos));
      editFiles.forEach(({ file }) => formData.append('photos', file));
      body = formData;
    }

    try {
      const response = await api.put(`produtos/${encodeURIComponent(productId)}`, body, { token });
      const updatedProduct = response?.body;
      if (!updatedProduct || typeof updatedProduct !== 'object') {
        throw new Error('A API não confirmou os dados atualizados do produto.');
      }
      setProducts((current) => current.map((product) =>
        getProductId(product) === productId ? updatedProduct : product
      ));
      closeEdit();
    } catch (error) {
      if (handleUnauthorized(error)) {
        setEditError('Sua sessão expirou. Entre novamente para continuar.');
      } else {
        setEditError(getErrorMessage(error, 'Não foi possível salvar as alterações.'));
      }
    } finally {
      editLoadingRef.current = false;
      setEditLoading(false);
    }
  }

  async function updateStatus(product, nextStatus) {
    const productId = getProductId(product);
    const currentStatus = getProductStatus(product);
    if (!productId || !nextStatus || nextStatus === currentStatus || busyProducts[productId]) return;

    setBusyProducts((current) => ({ ...current, [productId]: true }));
    setProductErrors((current) => ({ ...current, [productId]: '' }));
    try {
      const response = await api.patch(`produtos/${encodeURIComponent(productId)}/status`, { status: nextStatus }, { token });
      const updated = response?.body;
      if (!updated || getProductStatus(updated) !== nextStatus) {
        throw new Error('A API não confirmou a alteração de status.');
      }
      if (statusFilter && nextStatus !== statusFilter) {
        setReloadKey((current) => current + 1);
      } else {
        setProducts((current) => current.map((item) => getProductId(item) === productId ? updated : item));
      }
    } catch (error) {
      if (handleUnauthorized(error)) {
        setProductErrors((current) => ({ ...current, [productId]: 'Sua sessão expirou. Entre novamente para gerenciar suas doações.' }));
      } else {
        setProductErrors((current) => ({
          ...current,
          [productId]: getErrorMessage(error, 'Não foi possível alterar o status.')
        }));
      }
    } finally {
      setBusyProducts((current) => ({ ...current, [productId]: false }));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteLoading) return;
    const productId = getProductId(deleteTarget);
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await api.delete(`produtos/${encodeURIComponent(productId)}`, { token });
      setDeleteTarget(null);
      setReloadKey((current) => current + 1);
    } catch (error) {
      if (handleUnauthorized(error)) {
        setDeleteError('Sua sessão expirou. Entre novamente para continuar.');
      } else {
        setDeleteError(getErrorMessage(error, 'Não foi possível excluir o produto.'));
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  function setStatusFilterValue(value) {
    setStatusFilter(value);
    setPage(1);
  }

  return (
    <div className="my-donations-page">
      <Header />
      <main className="my-donations">
        <header className="my-donations__intro">
          <span className="my-donations__eyebrow">Suas publicações</span>
          <h1>Minhas Doações</h1>
          <p>Acompanhe e gerencie os itens que você compartilhou com a comunidade.</p>
        </header>

        {!token ? (
          <section className="my-donations__state">
            <h2>Entre para acessar suas doações</h2>
            <p>Somente sua conta autenticada pode visualizar e gerenciar suas publicações.</p>
            <Button onClick={openLogin}>Entrar</Button>
          </section>
        ) : (
          <>
            <div className="my-donations__toolbar">
              <p>
                {productState.loading || productState.error
                  ? 'Suas publicações'
                  : `${result.total} ${result.total === 1 ? 'publicação' : 'publicações'}`}
              </p>
              <label className="my-donations__status-filter">
                <span>Filtrar por status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilterValue(event.target.value)}
                  aria-label="Filtrar por status"
                >
                  <option value="">Todos os status</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {categoryState.error && (
              <div className="my-donations__notice" role="alert">
                <p>{categoryState.error}</p>
                <Button variant="outline" onClick={() => setReloadCategories((current) => current + 1)}>
                  Tentar carregar categorias novamente
                </Button>
              </div>
            )}

            {productState.loading ? (
              <div className="my-donations__state" role="status" aria-live="polite">
                <span className="my-donations__spinner" aria-hidden="true" />
                <p>Carregando suas doações…</p>
              </div>
            ) : productState.error ? (
              <div className="my-donations__state my-donations__state--error" role="alert">
                <p>{productState.error}</p>
                <Button variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
                  Tentar novamente
                </Button>
              </div>
            ) : products.length === 0 ? (
              <div className="my-donations__state">
                <h2>{statusFilter ? 'Nenhuma doação com esse status' : 'Você ainda não publicou doações'}</h2>
                <p>
                  {statusFilter
                    ? 'Altere o filtro para ver publicações com outros status.'
                    : 'Quando publicar um item, você poderá acompanhar e gerenciar a publicação por aqui.'}
                </p>
                {!statusFilter && <Button as={Link} to="/doar">Publicar Doação</Button>}
              </div>
            ) : (
              <>
                <div className="my-donations__grid">
                  {products.map((product) => {
                    const productId = getProductId(product);
                    const categoryId = getId(product.categoryId || product.category?._id);
                    const categoryName = product.category?.name
                      || product.categoryName
                      || (typeof product.category === 'string' ? product.category : '')
                      || categoryNames.get(categoryId)
                      || '';
                    const itemStatus = getProductStatus(product);
                    const statusLabel = STATUS_OPTIONS.find((status) => status.value === itemStatus)?.label || itemStatus;
                    const date = formatPublicationDate(product.createdAt || product.dataCriacao);
                    const photos = getProductPhotos(product);
                    const busy = Boolean(busyProducts[productId]);

                    return (
                      <article className="my-donations__card" key={productId}>
                        <ProductCard
                          product={{ ...product, categoryName }}
                          detailsTo={`/produtos/${encodeURIComponent(productId)}`}
                        />
                        <div className="my-donations__card-meta">
                          {date && <span>Publicado em {date}</span>}
                          {!categoryName && !categoryState.loading && (
                            <span className="my-donations__muted">
                              Categoria não identificada
                            </span>
                          )}
                          {photos.length > 1 && <span>{photos.length} fotografias</span>}
                        </div>

                        <div className="my-donations__card-actions">
                          <label>
                            <span>Status</span>
                            <select
                              value={itemStatus}
                              onChange={(event) => updateStatus(product, event.target.value)}
                              disabled={busy}
                              aria-label={`Alterar status de ${product.name || product.nome || 'produto'}`}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                          </label>
                          <Button variant="outline" onClick={() => openEdit(product)} disabled={busy}>
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setDeleteError('');
                              setDeleteTarget(product);
                            }}
                            disabled={busy}
                          >
                            Excluir
                          </Button>
                        </div>
                        {productErrors[productId] && (
                          <p className="my-donations__card-error" role="alert">
                            {productErrors[productId]}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>

                {result.pages > 1 && (
                  <nav className="my-donations__pagination" aria-label="Paginação das doações">
                    <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                      Anterior
                    </Button>
                    <span>Página {page} de {result.pages}</span>
                    <Button
                      variant="outline"
                      disabled={page >= result.pages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Próxima
                    </Button>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </main>
      <Modal
        open={Boolean(editing.product)}
        onClose={closeEdit}
        title="Editar doação"
        description="Atualize as informações da sua publicação."
        className="my-donations__edit-modal"
        closeOnEscape={!editLoading}
        closeOnOverlay={!editLoading}
      >
        {editing.product && (
          <form className="my-donations__edit-form" onSubmit={submitEdit} noValidate>
            <Input
              label="Nome do produto"
              value={editing.name}
              onChange={(event) => updateEditField('name', event.target.value)}
              maxLength={120}
              required
              disabled={editLoading}
            />

            <label className="my-donations__edit-field">
              <span>Categoria</span>
              <select
                value={editing.categoryId}
                onChange={(event) => {
                  updateEditField('categoryId', event.target.value);
                  updateEditField('subcategory', '');
                }}
                disabled={categoryState.loading || Boolean(categoryState.error) || editLoading}
                required
              >
                <option value="">Selecione uma categoria</option>
                {categories.map((category) => (
                  <option key={getId(category._id)} value={getId(category._id)}>{category.name}</option>
                ))}
              </select>
            </label>

            <label className="my-donations__edit-field">
              <span>Subcategoria</span>
              <select
                value={editing.subcategory}
                onChange={(event) => updateEditField('subcategory', event.target.value)}
                disabled={!editing.categoryId || editCategoryState.loading || Boolean(editCategoryState.error) || editLoading}
                required
              >
                <option value="">
                  {editCategoryState.loading ? 'Carregando subcategorias…' : 'Selecione uma subcategoria'}
                </option>
                {editSubcategories.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>{subcategory}</option>
                ))}
              </select>
              {editCategoryState.error && (
                <span className="my-donations__card-error" role="alert">
                  {editCategoryState.error}
                  <button type="button" onClick={() => setReloadEditCategory((current) => current + 1)}>
                    Tentar novamente
                  </button>
                </span>
              )}
            </label>

            <Input
              label="Estado de conservação"
              value={editing.condition}
              onChange={(event) => updateEditField('condition', event.target.value)}
              maxLength={120}
              required
              disabled={editLoading}
            />
            <Input
              label="Bairro ou região"
              value={editing.neighborhood}
              onChange={(event) => updateEditField('neighborhood', event.target.value)}
              maxLength={120}
              required
              disabled={editLoading}
            />
            <Input
              label="Descrição"
              as="textarea"
              value={editing.description}
              onChange={(event) => updateEditField('description', event.target.value)}
              maxLength={2000}
              required
              disabled={editLoading}
            />

            <section className="my-donations__edit-photos">
              <div>
                <h3>Fotografias</h3>
                <p>Até cinco imagens JPEG, PNG ou WEBP; máximo de 5 MB cada.</p>
              </div>
              {originalPhotos.length > 0 && (
                <div className="my-donations__edit-photo-grid">
                  {originalPhotos.map((photo, index) => {
                    const photoUrl = getPhotoUrl(photo);
                    const publicId = photo?.publicId;
                    const removed = Boolean(publicId && removedPhotoIds.includes(publicId));
                    return (
                      <figure className={removed ? 'is-removed' : ''} key={`${photoUrl}-${index}`}>
                        {photoUrl && <img src={photoUrl} alt={`Fotografia atual ${index + 1}`} />}
                        {publicId ? (
                          <button
                            type="button"
                            onClick={() => setRemovedPhotoIds((current) => (
                              removed
                                ? current.filter((id) => id !== publicId)
                                : [...current, publicId]
                            ))}
                            disabled={editLoading}
                          >
                            {removed ? 'Manter' : 'Remover'}
                          </button>
                        ) : (
                          <figcaption>Não é possível remover esta imagem pela API.</figcaption>
                        )}
                      </figure>
                    );
                  })}
                </div>
              )}
              <label className="my-donations__edit-upload">
                <span>Adicionar imagens</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={addEditPhotos}
                  disabled={editLoading || maximumNewPhotos <= editFiles.length}
                />
              </label>
              {editPhotoError && <p className="my-donations__card-error" role="alert">{editPhotoError}</p>}
              {editFiles.length > 0 && (
                <div className="my-donations__edit-photo-grid">
                  {editFiles.map((photo) => (
                    <figure key={photo.id}>
                      <img src={photo.preview} alt={`Nova imagem ${photo.file.name}`} />
                      <button type="button" onClick={() => removeEditFile(photo.id)} disabled={editLoading}>
                        Remover
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </section>

            {editError && <p className="my-donations__card-error" role="alert">{editError}</p>}
            <div className="my-donations__edit-actions">
              <Button type="submit" loading={editLoading}>Salvar alterações</Button>
              <Button type="button" variant="outline" onClick={closeEdit} disabled={editLoading}>Cancelar</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteLoading) {
            setDeleteTarget(null);
            setDeleteError('');
          }
        }}
        title="Excluir publicação?"
        description="Esta ação pode ser irreversível."
        className="my-donations__delete-modal"
        closeOnEscape={!deleteLoading}
        closeOnOverlay={!deleteLoading}
      >
        <div className="my-donations__delete-content">
          <p>
            A publicação “{deleteTarget?.name || deleteTarget?.nome || 'Produto'}” será removida.
            Confirme somente se deseja prosseguir.
          </p>
          {deleteError && <p className="my-donations__card-error" role="alert">{deleteError}</p>}
          <div className="my-donations__edit-actions">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmDelete} loading={deleteLoading}>
              Confirmar exclusão
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
