import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { Link } from "react-router-dom";
import { getActiveTier, getHypePercent, getSpotsLeft, type PartyEvent } from "../data/events";
import StatusBadge from "./StatusBadge";

export default function EventCard({ event }: { event: PartyEvent }) {
  const activeTier = getActiveTier(event);
  const hype = getHypePercent(event);

  return (
    <article className="event-card">
      <div className="event-card-hero" style={{ background: event.hero }}>
        <StatusBadge status={event.status} />
      </div>
      <div className="event-card-body">
        <div className="event-card-title">
          <div>
            <p className="eyebrow">{event.category}</p>
            <h3>{event.title}</h3>
          </div>
          <strong>${activeTier.price}</strong>
        </div>
        <p className="muted">{event.tagline}</p>
        <div className="event-meta">
          <span>
            <CalendarDays size={15} /> {event.date}
          </span>
          <span>
            <MapPin size={15} /> {event.location}
          </span>
          <span>
            <Ticket size={15} /> {getSpotsLeft(event)} spots left
          </span>
        </div>
        <div className="card-meter">
          <span style={{ width: `${hype}%` }} />
        </div>
        <div className="event-card-footer">
          <span>{hype}% funded</span>
          <Link className="button button-secondary" to={`/events/${event.id}`}>
            View Event
          </Link>
        </div>
      </div>
    </article>
  );
}
