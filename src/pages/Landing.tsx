import { Link } from "react-router-dom";
import EventCard from "../components/EventCard";
import Navbar from "../components/Navbar";
import { events } from "../data/events";

export default function Landing() {
  return (
    <main>
      <Navbar />
      <section className="hero-section page-shell">
        <div className="hero-copy">
          <p className="eyebrow">Campus events, backed by real demand</p>
          <h1>Launch parties only when the hype is real.</h1>
          <p>
            party.fun helps organisers reduce upfront risk while giving students a clear signal that an event has enough committed people to be worth joining.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/events/poolside-sesh-vol-3">
              Explore Events
            </Link>
            <Link className="button button-secondary" to="/signup/admin">
              Create Event
            </Link>
          </div>
        </div>
        <div className="hero-panel">
          <span className="live-dot">Live</span>
          <h2>Poolside Sesh Vol. 3</h2>
          <p>126 backers locked in</p>
          <div className="hero-meter">
            <span style={{ width: "42%" }} />
          </div>
          <strong>42% funded</strong>
          <small>Threshold: 300 backers</small>
        </div>
      </section>

      <section className="page-shell section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Discover</p>
            <h2>Events building momentum</h2>
          </div>
          <div className="filter-pills" aria-label="Event filters">
            <span>All</span>
            <span>This week</span>
            <span>CCA</span>
            <span>Confirmed</span>
          </div>
        </div>
        <div className="event-grid">
          {events.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
