import { ArrowRight, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import HypeMeter from "../components/HypeMeter";
import Navbar from "../components/Navbar";
import PricingTier from "../components/PricingTier";
import TicketPricesOverTime from "../components/TicketPricesOverTime";
import { getActiveTier, getEvent, getSpotsLeft } from "../data/events";

export default function EventDetail() {
  const { eventId } = useParams();
  const event = getEvent(eventId);
  const activeTier = getActiveTier(event);

  return (
    <main>
      <Navbar />
      <div className="page-shell detail-layout">
        <section className="detail-main">
          <div className="event-hero" style={{ background: event.hero }}>
            <p className="eyebrow">{event.category}</p>
            <h1>{event.title}</h1>
            <p>{event.tagline}</p>
          </div>

          <div className="quick-facts">
            <div>
              <CalendarDays size={18} />
              <span>Date</span>
              <strong>{event.date}</strong>
            </div>
            <div>
              <Clock size={18} />
              <span>Time</span>
              <strong>{event.time}</strong>
            </div>
            <div>
              <MapPin size={18} />
              <span>Location</span>
              <strong>{event.location}</strong>
            </div>
            <div>
              <Users size={18} />
              <span>Spots left</span>
              <strong>{getSpotsLeft(event)}</strong>
            </div>
          </div>

          <section className="content-card">
            <h2>About this party</h2>
            <p>{event.description}</p>
          </section>

          <section className="content-card">
            <TicketPricesOverTime event={event} />
            <HypeMeter event={event} />
            <div className="stats-grid">
              <div>
                <span>Threshold</span>
                <strong>{event.threshold} backers</strong>
              </div>
              <div>
                <span>Pledged</span>
                <strong>{event.pledged}</strong>
              </div>
              <div>
                <span>Spots left</span>
                <strong>{getSpotsLeft(event)}</strong>
              </div>
            </div>
          </section>

          <section className="content-card">
            <div className="section-heading compact">
              <h2>Bonding curve</h2>
              <span>Buy early, pay less</span>
            </div>
            <div className="pricing-list">
              {event.tiers.map((tier) => (
                <PricingTier tier={tier} active={tier.id === activeTier.id} key={tier.id} />
              ))}
            </div>
          </section>

          <section className="content-card">
            <h2>How it works</h2>
            <p>
              <strong>Buy early</strong> - earlier tiers are cheaper.
            </p>
            <p>
              <strong>Hit the threshold</strong> - the event is confirmed and the party is on.
            </p>
            <p>
              <strong>Missed the threshold?</strong> In a real payment flow, authorisations would be released or refunds would be issued automatically.
            </p>
          </section>
        </section>

        <aside className="checkout-card">
          <p className="eyebrow">{activeTier.name}</p>
          <div className="price-line">
            <strong>${activeTier.price}</strong>
            <span>per ticket</span>
          </div>
          <p className="warning-text">Price rises at the next tier</p>
          <Link className="button button-primary full-width" to={`/checkout/${event.id}`}>
            Buy Ticket · ${activeTier.price} <ArrowRight size={18} />
          </Link>
          <Link className="button button-secondary full-width" to="/login">
            Login or Create Account
          </Link>
          <div className="trust-note">
            Funds are only captured when the event reaches its hype threshold. If it does not, you are refunded automatically.
          </div>
        </aside>
      </div>
    </main>
  );
}
