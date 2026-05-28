import { Link, NavLink } from "react-router-dom";
import Logo from "./Logo";

export default function Navbar() {
  return (
    <header className="navbar">
      <Logo />
      <nav className="navbar-links" aria-label="Primary navigation">
        <NavLink to="/" className={({ isActive }) => (isActive ? "active" : "")}>
          Events
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}>
          My Events
        </NavLink>
        <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
          Admin
        </NavLink>
      </nav>
      <div className="navbar-actions">
        <Link className="ghost-link" to="/login">
          Login
        </Link>
        <Link className="button button-primary" to="/signup">
          Create Account
        </Link>
      </div>
    </header>
  );
}
