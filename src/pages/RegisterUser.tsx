import { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";

export default function RegisterUser() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/profile");
  }

  return (
    <main className="auth-page">
      <Logo />
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow">User signup</p>
        <h1>Create a user account</h1>
        <label>
          Username
          <input name="username" placeholder="janetan" required />
        </label>
        <label>
          Email
          <input name="email" type="email" placeholder="jane@school.edu" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        <label>
          Telegram / phone
          <input name="contact" placeholder="@janetan" />
        </label>
        <button className="button button-primary full-width" type="submit">
          Create User Account
        </button>
        <p className="muted">
          Want to host events? <Link to="/signup/admin">Register as admin</Link>
        </p>
      </form>
    </main>
  );
}
