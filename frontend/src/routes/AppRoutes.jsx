import { Route, Routes } from 'react-router-dom';
import Home from '../pages/Home/Home.jsx';
import Explore from '../pages/Explore/Explore.jsx';
import ProductDetails from '../pages/ProductDetails/ProductDetails.jsx';
import CreateDonation from '../pages/CreateDonation/CreateDonation.jsx';
import MyDonations from '../pages/MyDonations/MyDonations.jsx';
import Favorites from '../pages/Favorites/Favorites.jsx';
import Profile from '../pages/Profile/Profile.jsx';
import ResetPassword from '../pages/ResetPassword/ResetPassword.jsx';
import SocialAuthCallback from '../pages/SocialAuthCallback/SocialAuthCallback.jsx';

function InitialShell() {
  return (
    <main className="app-shell">
      <h1>DoaAí</h1>
      <p>Estrutura inicial pronta para as próximas etapas.</p>
    </main>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/explorar" element={<Explore />} />
      <Route path="/produtos/:id" element={<ProductDetails />} />
      <Route path="/doar" element={<CreateDonation />} />
      <Route path="/minhas-doacoes" element={<MyDonations />} />
      <Route path="/favoritos" element={<Favorites />} />
      <Route path="/perfil" element={<Profile />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route path="/auth/social/callback" element={<SocialAuthCallback />} />
      <Route path="*" element={<InitialShell />} />
    </Routes>
  );
}
