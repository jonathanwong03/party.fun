import { Edit3, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import AdminSidebar from "../components/AdminSidebar";
import DeleteEventModal from "../components/DeleteEventModal";
import HypeMeter from "../components/HypeMeter";
import StatusBadge from "../components/StatusBadge";
import { attendees, events, getActiveTier, getHypePercent, type PartyEvent } from "../data/events";

export default function AdminDashboard() {
  const [deleteTarget, setDeleteTarget] = useState<PartyEvent | null>(null);
  const liveEvents = events.filter((event) => event.status === "live").length;
  const confirmedEvents = events.filter((event) => event.status === "confirmed").length;

  return (
    <main className="admin-layout">
      <AdminSidebar />
      <section className="admin-main">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Admin dashboard</p>
            <h1>Manage your events</h1>
            <p className="muted">Mock organiser tools for tracking event hype, tickets and pledge progress.</p>
          </div>
          <Link className="button button-primary" to="/admin/events/new">
            Create New Event
          </Link>
        </div>

        <div className="admin-stat-grid">
          <div>
            <span>Total events</span>
            <strong>{events.length}</strong>
          </div>
          <div>
            <span>Live events</span>
            <strong>{liveEvents}</strong>
          </div>
          <div>
            <span>Confirmed</span>
            <strong>{confirmedEvents}</strong>
          </div>
          <div>
            <span>Total pledges</span>
            <strong>{attendees.length}</strong>
          </div>
        </div>

        <section className="admin-card">
          <div className="section-heading compact">
            <h2>Event performance</h2>
            <span>Analytics, attendees and tickets are represented here for the MVP.</span>
          </div>
          <div className="dashboard-feature-grid">
            {events.slice(0, 2).map((event) => (
              <HypeMeter event={event} compact key={event.id} />
            ))}
          </div>
        </section>

        <section className="admin-card">
          <div className="section-heading compact">
            <h2>Events</h2>
            <span>Frontend-only data</span>
          </div>
          <div className="admin-table">
            <div className="admin-table-row header">
              <span>Event</span>
              <span>Hype</span>
              <span>Tier</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {events.map((event) => (
              <div className="admin-table-row" key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <small>{event.date} · {event.location}</small>
                </div>
                <span>{getHypePercent(event)}%</span>
                <span>${getActiveTier(event).price}</span>
                <StatusBadge status={event.status} />
                <div className="row-actions">
                  <Link className="icon-button" to={`/admin/events/${event.id}/edit`} aria-label={`Edit ${event.title}`}>
                    <Edit3 size={17} />
                  </Link>
                  <button className="icon-button danger" onClick={() => setDeleteTarget(event)} aria-label={`Delete ${event.title}`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
      <DeleteEventModal event={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => setDeleteTarget(null)} />
    </main>
  );
}
