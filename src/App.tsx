import { Navigate, Route, Routes } from "react-router-dom";
import AdminDashboard from "./pages/AdminDashboard";
import Checkout from "./pages/Checkout";
import ChooseAccount from "./pages/ChooseAccount";
import Confirmation from "./pages/Confirmation";
import CreateEvent from "./pages/CreateEvent";
import EditEvent from "./pages/EditEvent";
import EventDetail from "./pages/EventDetail";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import RegisterAdmin from "./pages/RegisterAdmin";
import RegisterUser from "./pages/RegisterUser";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/events/:eventId" element={<EventDetail />} />
      <Route path="/checkout/:eventId" element={<Checkout />} />
      <Route path="/confirmation" element={<Confirmation />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<ChooseAccount />} />
      <Route path="/signup/user" element={<RegisterUser />} />
      <Route path="/signup/admin" element={<RegisterAdmin />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/events/new" element={<CreateEvent />} />
      <Route path="/admin/events/:eventId/edit" element={<EditEvent />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
