import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../services/api.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { Button, Header, Input, Modal } from '../../components/index.js';
import './CreateDonation.css';

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const INITIAL_VALUES = {
  name: '',
  categoryId: '',
  subcategory: '',
  condition: '',
  description: '',
  neighborhood: ''
};

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getProductId(product) {
  const id = product?._id || product?.id;
  return typeof id === 'string' ? id : id?.toString?.() || '';
}

export default function CreateDonation() {
  const { token, signOut, openLogin } = useAuth();
  const [values, setValues] = useState(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState({});
  const [categories, setCategories] = useState([]);
  const [categoryState, setCategoryState] = useState({ loading: true, error: '' });
  const [subcategories, setSubcategories] = useState([]);
  const [subcategoryState, setSubcategoryState] = useState({ loading: false, error: '' });
  const [reloadSubcategories, setReloadSubcategories] = useState(0);
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef(photos);
  const submittingRef = useRef(false);
  const [photoError, setPhotoError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reloadCategories, setReloadCategories] = useState(0);
  const [confirmation, setConfirmation] = useState({ open: false, productId: '' });

  photosRef.current = photos;

  useEffect(() => () => {
    photosRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
  }, []);

  useEffect(() => {
    let active = true;
    setCategoryState({ loading: true, error: '' });

    api.get('categorias')
      .then((response) => {
        if (!Array.isArray(response?.body)) {
          throw new Error('A API retornou a lista de categorias em formato inesperado.');
        }
        if (!active) return;
        setCategories(response.body.filter((category) => category?.active !== false));
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
    if (!values.categoryId) {
      setSubcategories([]);
      setSubcategoryState({ loading: false, error: '' });
      return undefined;
    }

    setSubcategories([]);
    setSubcategoryState({ loading: true, error: '' });
    api.get(`categorias/${encodeURIComponent(values.categoryId)}`)
      .then((response) => {
        const category = response?.body;
        if (!Array.isArray(category?.subcategories)) {
          throw new Error('A API retornou as subcategorias em formato inesperado.');
        }
        if (!active) return;
        setSubcategories(category.subcategories);
        setSubcategoryState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        setSubcategories([]);
        setSubcategoryState({
          loading: false,
          error: getErrorMessage(error, 'Não foi possível carregar as subcategorias.')
        });
      });

    return () => {
      active = false;
    };
  }, [reloadSubcategories, values.categoryId]);

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
    setRequestError('');
  }

  function handleCategoryChange(event) {
    setValues((current) => ({ ...current, categoryId: event.target.value, subcategory: '' }));
    setFieldErrors((current) => ({ ...current, categoryId: '', subcategory: '' }));
    setRequestError('');
  }

  function addPhotos(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    setPhotoError('');
    if (selected.length === 0) return;

    const currentPhotos = photosRef.current;
    if (currentPhotos.length + selected.length > MAX_PHOTOS) {
      setPhotoError(`Você pode selecionar no máximo ${MAX_PHOTOS} fotografias.`);
      return;
    }

    const errors = [];
    const validFiles = [];
    selected.forEach((file) => {
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        errors.push(`${file.name}: formato inválido. Use JPEG, PNG ou WEBP.`);
      } else if (file.size > MAX_PHOTO_SIZE) {
        errors.push(`${file.name}: o arquivo excede o limite de 5 MB.`);
      } else {
        validFiles.push(file);
      }
    });

    if (validFiles.length + currentPhotos.length > MAX_PHOTOS) {
      setPhotoError(`Você pode selecionar no máximo ${MAX_PHOTOS} fotografias.`);
      return;
    }

    if (errors.length) setPhotoError(errors.join(' '));
    if (!validFiles.length) return;

    const additions = validFiles.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      preview: URL.createObjectURL(file)
    }));
    setPhotos((current) => [...current, ...additions]);
  }

  function removePhoto(photoId) {
    const removed = photosRef.current.find((photo) => photo.id === photoId);
    if (removed) URL.revokeObjectURL(removed.preview);
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
    setPhotoError('');
  }

  function validateFields() {
    const errors = {};
    if (!values.name.trim()) errors.name = 'Informe o nome do produto.';
    else if (values.name.trim().length > 120) errors.name = 'Use até 120 caracteres.';

    if (!values.categoryId) errors.categoryId = 'Selecione uma categoria.';
    if (!values.subcategory) errors.subcategory = 'Selecione uma subcategoria.';

    if (!values.condition.trim()) errors.condition = 'Informe o estado de conservação.';
    else if (values.condition.trim().length > 120) errors.condition = 'Use até 120 caracteres.';

    if (!values.description.trim()) errors.description = 'Informe a descrição do produto.';
    else if (values.description.trim().length > 2000) errors.description = 'Use até 2000 caracteres.';

    if (!values.neighborhood.trim()) errors.neighborhood = 'Informe o bairro ou região.';
    else if (values.neighborhood.trim().length > 120) errors.neighborhood = 'Use até 120 caracteres.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const fieldsAreValid = validateFields();
    if (!token) {
      setRequestError('Entre na sua conta para publicar a doação. Seus dados preenchidos serão mantidos.');
      openLogin();
      return;
    }
    if (!fieldsAreValid) {
      setRequestError('');
      return;
    }
    if (categoryState.loading || categoryState.error || subcategoryState.loading || subcategoryState.error) {
      setRequestError('Aguarde o carregamento das categorias antes de publicar.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setRequestError('');

    const formData = new FormData();
    formData.append('name', values.name.trim());
    formData.append('categoryId', values.categoryId);
    formData.append('subcategory', values.subcategory);
    formData.append('condition', values.condition.trim());
    formData.append('description', values.description.trim());
    formData.append('neighborhood', values.neighborhood.trim());
    photos.forEach(({ file }) => formData.append('photos', file));

    try {
      const response = await api.post('produtos', formData, { token });
      const productId = getProductId(response?.body);
      if (!productId) {
        throw new Error('A publicação foi confirmada, mas a API não retornou o identificador do produto.');
      }
      setConfirmation({ open: true, productId });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        openLogin();
        setRequestError('Sua sessão expirou. Entre novamente para continuar; os dados preenchidos foram mantidos.');
      } else {
        setRequestError(getErrorMessage(error, 'Não foi possível publicar a doação.'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function cancelCreation() {
    if (submitting) return;
    setValues(INITIAL_VALUES);
    setFieldErrors({});
    photosRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setPhotos([]);
    setPhotoError('');
    setRequestError('');
  }

  return (
    <div className="create-donation-page">
      <Header />
      <main className="create-donation">
        <header className="create-donation__intro">
          <span className="create-donation__eyebrow">Compartilhe o que pode fazer diferença</span>
          <h1>Publicar Doação</h1>
          <p>Conte um pouco sobre o item e ajude-o a encontrar um novo lar.</p>
        </header>

        <form className="create-donation__form" onSubmit={handleSubmit} noValidate>
          {!token && (
            <p className="create-donation__auth-note">
              Você pode preencher o formulário. Para publicar, será necessário entrar na sua conta.
            </p>
          )}

          <div className="create-donation__field-grid">
            <Input
              label="Nome do produto"
              name="name"
              value={values.name}
              onChange={(event) => setField('name', event.target.value)}
              error={fieldErrors.name}
              maxLength={120}
              required
              disabled={submitting}
            />

            <label className="create-donation__field">
              <span>Categoria</span>
              <select
                name="categoryId"
                value={values.categoryId}
                onChange={handleCategoryChange}
                disabled={categoryState.loading || Boolean(categoryState.error) || submitting}
                required
                aria-invalid={fieldErrors.categoryId ? 'true' : undefined}
              >
                <option value="">
                  {categoryState.loading ? 'Carregando categorias…' : 'Selecione uma categoria'}
                </option>
                {categories.map((category) => (
                  <option key={category._id} value={category._id}>{category.name}</option>
                ))}
              </select>
              {fieldErrors.categoryId && <span className="create-donation__field-error" role="alert">{fieldErrors.categoryId}</span>}
              {categoryState.error && (
                <span className="create-donation__field-error" role="alert">
                  {categoryState.error}
                  {' '}
                  <button type="button" onClick={() => setReloadCategories((current) => current + 1)}>
                    Tentar novamente
                  </button>
                </span>
              )}
            </label>

            <label className="create-donation__field">
              <span>Subcategoria</span>
              <select
                name="subcategory"
                value={values.subcategory}
                onChange={(event) => setField('subcategory', event.target.value)}
                disabled={!values.categoryId || subcategoryState.loading || Boolean(subcategoryState.error) || submitting}
                required
                aria-invalid={fieldErrors.subcategory ? 'true' : undefined}
              >
                <option value="">
                  {subcategoryState.loading ? 'Carregando subcategorias…' : 'Selecione uma subcategoria'}
                </option>
                {subcategories.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>{subcategory}</option>
                ))}
              </select>
              {fieldErrors.subcategory && <span className="create-donation__field-error" role="alert">{fieldErrors.subcategory}</span>}
              {subcategoryState.error && (
                <span className="create-donation__field-error" role="alert">
                  {subcategoryState.error}
                  {' '}
                  <button type="button" onClick={() => setReloadSubcategories((current) => current + 1)}>
                    Tentar novamente
                  </button>
                </span>
              )}
            </label>

            <Input
              label="Estado de conservação"
              name="condition"
              value={values.condition}
              onChange={(event) => setField('condition', event.target.value)}
              error={fieldErrors.condition}
              maxLength={120}
              hint="Descreva a condição atual do item."
              required
              disabled={submitting}
            />

            <Input
              label="Bairro ou região"
              name="neighborhood"
              value={values.neighborhood}
              onChange={(event) => setField('neighborhood', event.target.value)}
              error={fieldErrors.neighborhood}
              maxLength={120}
              hint="Informe apenas uma localização aproximada."
              required
              disabled={submitting}
            />

            <Input
              className="create-donation__description"
              label="Descrição do produto"
              name="description"
              as="textarea"
              value={values.description}
              onChange={(event) => setField('description', event.target.value)}
              error={fieldErrors.description}
              maxLength={2000}
              required
              disabled={submitting}
            />
          </div>

          <section className="create-donation__photos" aria-labelledby="create-donation-photos-title">
            <div className="create-donation__photos-heading">
              <div>
                <h2 id="create-donation-photos-title">Fotografias</h2>
                <p>Adicione até cinco imagens JPEG, PNG ou WEBP, com no máximo 5 MB cada.</p>
              </div>
              <span>{photos.length}/{MAX_PHOTOS}</span>
            </div>

            <label className={`create-donation__upload${photos.length >= MAX_PHOTOS ? ' is-disabled' : ''}`}>
              <input
                type="file"
                name="photos"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={addPhotos}
                disabled={photos.length >= MAX_PHOTOS || submitting}
                aria-label="Selecionar fotografias"
              />
              <span className="create-donation__upload-icon" aria-hidden="true">+</span>
              <span className="create-donation__upload-title">Adicionar fotografias</span>
              <span className="create-donation__upload-hint">JPEG, PNG ou WEBP · até 5 MB por imagem</span>
            </label>

            {photoError && <p className="create-donation__field-error" role="alert">{photoError}</p>}

            {photos.length > 0 && (
              <div className="create-donation__photo-grid">
                {photos.map((photo, index) => (
                  <figure className="create-donation__photo" key={photo.id}>
                    <img src={photo.preview} alt={`Pré-visualização ${index + 1}: ${photo.file.name}`} />
                    <figcaption>{photo.file.name}</figcaption>
                    <button
                      type="button"
                      aria-label={`Remover imagem ${index + 1}`}
                      onClick={() => removePhoto(photo.id)}
                      disabled={submitting}
                    >
                      ×
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </section>

          {requestError && <p className="create-donation__request-error" role="alert">{requestError}</p>}

          <div className="create-donation__actions">
            <Button type="submit" loading={submitting} disabled={submitting}>
              Publicar Doação
            </Button>
            <Button
              as={Link}
              to="/explorar"
              variant="outline"
              onClick={(event) => {
                if (submitting) {
                  event.preventDefault();
                  return;
                }
                cancelCreation();
              }}
              className={submitting ? 'is-disabled' : ''}
              aria-disabled={submitting || undefined}
              tabIndex={submitting ? -1 : undefined}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </main>
      <Modal
        open={confirmation.open}
        onClose={() => setConfirmation({ open: false, productId: '' })}
        title="Doação publicada!"
        description="Seu produto já está disponível para a comunidade."
        className="create-donation__confirmation"
      >
        <div className="create-donation__confirmation-actions">
          <Button as={Link} to={`/produtos/${encodeURIComponent(confirmation.productId)}`}>
            Visualizar produto
          </Button>
          <Button as={Link} to="/minhas-doacoes" variant="outline">
            Minhas Doações
          </Button>
        </div>
      </Modal>
    </div>
  );
}
