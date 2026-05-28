import { CalendarPlus, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";

export default function ChooseAccount() {
  return (
    <main className="auth-page">
      <Logo />
      <section className="auth-card wide">
        <p className="eyebrow">Create account</p>
        <h1>How will you use party.fun?</h1>
        <div className="choice-grid">
          <Link className="choice-card" to="/signup/user">
            <Ticket size={28} />
            <strong>User</strong>
            <span>Buy tickets, track your events and join the hype.</span>
          </Link>
          <Link className="choice-card" to="/signup/admin">
            <CalendarPlus size={28} />
            <strong>Admin / Organiser</strong>
            <span>Create, manage and launch campus events.</span>
          </Link>
        </div>
        <p className="muted">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </section>
    </main>
  );
}
