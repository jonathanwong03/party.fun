import { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";

export default function RegisterAdmin() {
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/admin");
  }

  return (
    <main className="auth-page">
      <Logo />
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="eyebrow">Admin signup</p>
        <h1>Create organiser account</h1>
        <label>
          Organisation / CCA name
          <input name="organisation" placeholder="SMU Social Club" required />
        </label>
        <label>
          Admin name
          <input name="name" placeholder="Jane Tan" required />
        </label>
        <label>
          Email
          <input name="email" type="email" placeholder="admin@school.edu" required />
        </label>
        <label>
          Password
          <input name="password" type="password" required />
        </label>
        <label>
          Telegram / phone
          <input name="contact" placeholder="@organiser" />
        </label>
        <button className="button button-primary full-width" type="submit">
          Create Admin Account
        </button>
        <p className="muted">
          Buying tickets only? <Link to="/signup/user">Register as user</Link>
        </p>
      </form>
    </main>
  );
}
