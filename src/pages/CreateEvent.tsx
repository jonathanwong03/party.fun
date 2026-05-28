import AdminSidebar from "../components/AdminSidebar";
import EventForm from "../components/EventForm";

export default function CreateEvent() {
  return (
    <main className="admin-layout">
      <AdminSidebar />
      <section className="admin-main">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Create event</p>
            <h1>Launch a new party</h1>
            <p className="muted">Configure event details, threshold, capacity and pricing tiers.</p>
          </div>
        </div>
        <EventForm mode="create" />
      </section>
    </main>
  );
}
