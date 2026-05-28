import { useParams } from "react-router-dom";
import AdminSidebar from "../components/AdminSidebar";
import EventForm from "../components/EventForm";
import { getEvent } from "../data/events";

export default function EditEvent() {
  const { eventId } = useParams();
  const event = getEvent(eventId);

  return (
    <main className="admin-layout">
      <AdminSidebar />
      <section className="admin-main">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Edit event</p>
            <h1>{event.title}</h1>
            <p className="muted">Some sensitive fields would be locked after confirmation in production.</p>
          </div>
        </div>
        <EventForm mode="edit" event={event} />
      </section>
    </main>
  );
}
