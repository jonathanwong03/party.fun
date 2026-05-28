import { Link } from "react-router-dom";
import EventCard from "../components/EventCard";
import Navbar from "../components/Navbar";
import { attendees, events } from "../data/events";

export default function Profile() {
  const myAttendees = attendees.slice(0, 2);
  const myEvents = events.filter((event) => myAttendees.some((attendee) => attendee.eventId === event.id));

  return (
    <main>
      <Navbar />
      <section className="page-shell section-block">
        <div className="profile-header">
          <div>
            <p className="eyebrow">My Events</p>
            <h1>Jane Tan</h1>
            <p className="muted">Track pledged tickets, confirmed events and refunds from one place.</p>
          </div>
          <Link className="button button-primary" to="/">
            Browse More Events
          </Link>
        </div>

        <div className="stats-grid profile-stats">
          <div>
            <span>Upcoming</span>
            <strong>{myEvents.length}</strong>
          </div>
          <div>
            <span>Tickets pledged</span>
            <strong>{myAttendees.reduce((sum, attendee) => sum + attendee.tickets, 0)}</strong>
          </div>
          <div>
            <span>Refunded</span>
            <strong>0</strong>
          </div>
        </div>

        <div className="tabs-row">
          <span className="active">Upcoming</span>
          <span>Past</span>
          <span>Cancelled / refunded</span>
        </div>

        <div className="event-grid">
          {myEvents.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
