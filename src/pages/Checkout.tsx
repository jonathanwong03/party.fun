import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getActiveTier, getEvent } from "../data/events";

export default function Checkout() {
  const { eventId } = useParams();
  const event = getEvent(eventId);
  const tier = getActiveTier(event);
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const total = quantity * tier.price;

  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    navigate("/confirmation", {
      state: {
        eventTitle: event.title,
        quantity,
        total,
        tierName: tier.name,
      },
    });
  }

  return (
    <main>
      <Navbar />
      <section className="page-shell checkout-layout">
        <form className="form-card checkout-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Checkout</p>
            <h1>Confirm your pledge</h1>
            <p className="muted">Buy as a guest or use the same form while logged in. Account linking is mocked for this prototype.</p>
          </div>

          <label>
            Full name
            <input name="name" placeholder="Jane Tan" required />
          </label>
          <label>
            Email
            <input name="email" type="email" placeholder="jane@school.edu" required />
          </label>
          <label>
            Telegram / phone
            <input name="contact" placeholder="@janetan" />
          </label>

          <div className="quantity-row">
            <div>
              <strong>Ticket quantity</strong>
              <span className="muted">${tier.price} per ticket</span>
            </div>
            <div className="stepper">
              <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                -
              </button>
              <strong>{quantity}</strong>
              <button type="button" onClick={() => setQuantity(quantity + 1)}>
                +
              </button>
            </div>
          </div>

          <div className="payment-box">
            <p className="eyebrow">Simulated payment</p>
            <p>No real payment is collected in this frontend prototype.</p>
          </div>

          <button className="button button-primary full-width" type="submit">
            Confirm Pledge · ${total}
          </button>
        </form>

        <aside className="summary-card">
          <p className="eyebrow">Event summary</p>
          <h2>{event.title}</h2>
          <p className="muted">{event.date} · {event.time}</p>
          <p className="muted">{event.location}</p>
          <div className="summary-line">
            <span>Current tier</span>
            <strong>{tier.name}</strong>
          </div>
          <div className="summary-line">
            <span>Ticket price</span>
            <strong>${tier.price}</strong>
          </div>
          <div className="summary-line">
            <span>Quantity</span>
            <strong>{quantity}</strong>
          </div>
          <div className="summary-line total">
            <span>Total</span>
            <strong>${total}</strong>
          </div>
          <div className="trust-note">
            Production plan: authorise now, capture only when threshold is reached.
          </div>
        </aside>
      </section>
    </main>
  );
}
