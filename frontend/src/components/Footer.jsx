import { Link } from 'react-router-dom';
import logoNegative from '../assets/logo-doaai-negative.svg';
import './Footer.css';

export default function Footer({
  links = [
    { label: 'Explorar doações', to: '/explorar' },
    { label: 'Como funciona', to: '/#como-funciona' }
  ]
}) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__identity">
          <Link className="site-footer__brand" to="/" aria-label="DoaAí, página inicial">
            <img src={logoNegative} alt="" />
          </Link>
          <nav className="site-footer__links" aria-label="Links institucionais">
            {links.map(({ label, to }) => (
              <Link key={`${label}-${to}`} to={to}>{label}</Link>
            ))}
          </nav>
        </div>

        <div className="site-footer__help">
          <h2>Ficou com alguma dúvida?</h2>
          <p>Estamos aqui para ajudar</p>
        </div>

        <address className="site-footer__contact">
          <span>(55)11XXXX-XXXX</span>
          <a href="mailto:doaai@gmail.com">doaai@gmail.com</a>
        </address>

        <small className="site-footer__copyright">
          © 2026 DoaAí. Doação circular comunitária.
        </small>
      </div>
    </footer>
  );
}
