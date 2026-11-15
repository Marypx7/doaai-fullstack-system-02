import AppRoutes from './routes/AppRoutes.jsx';
import AuthModal from './components/AuthModal.jsx';
import Footer from './components/Footer.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';

export default function App() {
  return (
    <AuthProvider>
      <div className="app-layout">
        <div className="app-layout__content">
          <AppRoutes />
        </div>
        <Footer />
      </div>
      <AuthModal />
    </AuthProvider>
  );
}
