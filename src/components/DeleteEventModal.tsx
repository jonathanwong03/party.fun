import { AlertTriangle } from "lucide-react";
import type { PartyEvent } from "../data/events";

type DeleteEventModalProps = {
  event: PartyEvent | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteEventModal({ event, onCancel, onConfirm }: DeleteEventModalProps) {
  if (!event) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="modal-icon">
          <AlertTriangle size={24} />
        </div>
        <h2 id="delete-title">Delete Event?</h2>
        <p className="muted">
          This prototype will only simulate deletion, but in production this would remove <strong>{event.title}</strong> and notify affected attendees.
        </p>
        <div className="modal-actions">
          <button className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="button button-danger" onClick={onConfirm}>
            Delete Event
          </button>
        </div>
      </section>
    </div>
  );
}
