import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from './Button.jsx';
import './ProductCard.css';

function getCategory(product) {
  return product.category?.name
    || product.categoryName
    || product.category
    || '';
}

function getNeighborhood(product) {
  return product.neighborhood || product.bairro || '';
}

function getPhotoUrl(product) {
  const photo = product.photos?.[0] || product.fotografias?.[0];
  return typeof photo === 'string' ? photo : photo?.url;
}

export default function ProductCard({ product, detailsTo, onViewDetails }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!product) return null;

  const id = product._id || product.id;
  const name = product.name || product.nome || 'Produto';
  const photoUrl = getPhotoUrl(product);
  const detailPath = detailsTo || `/produtos/${id}`;
  const detailContent = onViewDetails
    ? <Button variant="primary" onClick={() => onViewDetails(product)}>Ver detalhes</Button>
    : <Button as={Link} to={detailPath} variant="primary">Ver detalhes</Button>;
  const status = product.status || product.statusDoacao;
  const category = getCategory(product);
  const neighborhood = getNeighborhood(product);
  const statusLabel = {
    disponivel: 'Disponível',
    reservado: 'Reservado',
    doado: 'Doado'
  }[status] || status;

  return (
    <article className="product-card">
      {onViewDetails ? (
        <button
          className="product-card__image-link product-card__image-button"
          type="button"
          aria-label={`Ver detalhes de ${name}`}
          onClick={() => onViewDetails(product)}
        >
          <ProductImage
            imageFailed={imageFailed}
            name={name}
            photoUrl={photoUrl}
            onImageError={() => setImageFailed(true)}
          />
        </button>
      ) : (
        <Link className="product-card__image-link" to={detailPath} aria-label={`Ver detalhes de ${name}`}>
          <ProductImage
            imageFailed={imageFailed}
            name={name}
            photoUrl={photoUrl}
            onImageError={() => setImageFailed(true)}
          />
        </Link>
      )}

      <div className="product-card__body">
        <div className="product-card__title-row">
          <h2 className="product-card__title">{name}</h2>
          {statusLabel && <span className="product-card__status">{statusLabel}</span>}
        </div>
        {(category || neighborhood) && (
          <p className="product-card__meta">
            {category}
            {category && neighborhood && <span aria-hidden="true"> · </span>}
            {neighborhood}
          </p>
        )}
        {(product.condition || product.conservacao) && (
          <p className="product-card__condition">
            Conservação: {product.condition || product.conservacao}
          </p>
        )}
        <div className="product-card__action">{detailContent}</div>
      </div>
    </article>
  );
}

function ProductImage({ imageFailed, name, photoUrl, onImageError }) {
  if (!photoUrl || imageFailed) {
    return <span className="product-card__image-placeholder">Sem fotografia</span>;
  }
  return (
    <img
      className="product-card__image"
      src={photoUrl}
      alt={name}
      loading="lazy"
      onError={onImageError}
    />
  );
}
