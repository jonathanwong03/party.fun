import { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";

export default function Login() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = new FormData(event.currentTarget).get("role");
    navigate(role === "admin" ? "/admin" : "/profile");
  }

  return (
    <main className="auth-page">
      <Logo />
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow">Welcome back</p>
        <h1>Login to party.fun</h1>
        <label>
          Email or username
          <input name="username" placeholder="you@school.edu" required />
        </label>
        <label>
          Password
          <input name="password" type="password" placeholder="••••••••" required />
        </label>
        <label>
          Prototype role
          <select name="role" defaultValue="user">
            <option value="user">User</option>
            <option value="admin">Admin / organiser</option>
          </select>
        </label>
        <button className="button button-primary full-width" type="submit">
          Login
        </button>
        <p className="muted">
          No account yet? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </main>
  );
}
