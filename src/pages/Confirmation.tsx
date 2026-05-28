import { CheckCircle2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";

type ConfirmationState = {
  eventTitle?: string;
  quantity?: number;
  total?: number;
  tierName?: string;
};

export default function Confirmation() {
  const location = useLocation();
  const state = (location.state ?? {}) as ConfirmationState;

  return (
    <main>
      <Navbar />
      <section className="page-shell centered-page">
        <div className="confirmation-card">
          <CheckCircle2 size={54} />
          <p className="eyebrow">Pledge confirmed</p>
          <h1>You are in the hype queue.</h1>
          <p className="muted">
            Your ticket pledge for <strong>{state.eventTitle ?? "party.fun event"}</strong> has been recorded in this prototype.
          </p>
          <div className="stats-grid">
            <div>
              <span>Tickets</span>
              <strong>{state.quantity ?? 1}</strong>
            </div>
            <div>
              <span>Tier</span>
              <strong>{state.tierName ?? "Current tier"}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>${state.total ?? 0}</strong>
            </div>
          </div>
          <div className="form-actions">
            <Link className="button button-primary" to="/">
              Back to Events
            </Link>
            <Link className="button button-secondary" to="/profile">
              View My Events
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
