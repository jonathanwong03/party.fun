import { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { PartyEvent } from "../data/events";

type EventFormProps = {
  mode: "create" | "edit";
  event?: PartyEvent;
};

export default function EventForm({ mode, event }: EventFormProps) {
  const navigate = useNavigate();

  function handleSubmit(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    navigate("/admin");
  }

  return (
    <form className="event-form" onSubmit={handleSubmit}>
      <section className="form-card">
        <div>
          <p className="eyebrow">Basic details</p>
          <h2>{mode === "create" ? "Create a new event" : "Edit event"}</h2>
        </div>
        <label>
          Event title
          <input name="title" defaultValue={event?.title} placeholder="Poolside Sesh Vol. 3" required />
        </label>
        <label>
          Description
          <textarea name="description" defaultValue={event?.description} placeholder="Describe the event vibe, crowd and what is included." rows={5} required />
        </label>
        <div className="form-grid two">
          <label>
            Organiser / CCA
            <input name="organizer" defaultValue={event?.organizer} placeholder="SMU Social Club" />
          </label>
          <label>
            Category
            <select name="category" defaultValue={event?.category ?? "Social"}>
              <option>Social</option>
              <option>CCA</option>
              <option>Independent</option>
              <option>Off-campus</option>
            </select>
          </label>
        </div>
      </section>

      <section className="form-card">
        <div>
          <p className="eyebrow">Schedule and venue</p>
          <h2>When and where</h2>
        </div>
        <div className="form-grid three">
          <label>
            Date
            <input name="date" defaultValue={event?.date} placeholder="Sat, Jul 12" />
          </label>
          <label>
            Time
            <input name="time" defaultValue={event?.time} placeholder="6:30 PM" />
          </label>
          <label>
            Location
            <input name="location" defaultValue={event?.location} placeholder="Braddell CC" />
          </label>
        </div>
        <label>
          Hype deadline
          <input name="deadline" defaultValue={event?.deadline} placeholder="Jul 8, 11:59 PM" />
        </label>
      </section>

      <section className="form-card">
        <div>
          <p className="eyebrow">Threshold and capacity</p>
          <h2>Funding model</h2>
        </div>
        <div className="form-grid two">
          <label>
            Minimum hype threshold
            <input name="threshold" type="number" min="1" defaultValue={event?.threshold ?? 150} />
          </label>
          <label>
            Maximum capacity
            <input name="capacity" type="number" min="1" defaultValue={event?.capacity ?? 300} />
          </label>
        </div>
      </section>

      <section className="form-card">
        <div>
          <p className="eyebrow">Pricing tiers</p>
          <h2>Buy early, pay less</h2>
        </div>
        <div className="tier-editor">
          {(event?.tiers ?? [
            { id: "super", name: "Super Early", price: 12, capacity: 80 },
            { id: "early", name: "Early", price: 18, capacity: 80 },
            { id: "standard", name: "Standard", price: 26, capacity: 100 },
            { id: "final", name: "Confirmed Door", price: 40, capacity: 40 },
          ]).map((tier, index) => (
            <div className="tier-editor-row" key={tier.id}>
              <strong>{tier.name}</strong>
              <label>
                Price
                <input name={`tier-${index}-price`} type="number" min="0" defaultValue={tier.price} />
              </label>
              <label>
                Spots
                <input name={`tier-${index}-capacity`} type="number" min="0" defaultValue={tier.capacity} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className="form-actions sticky-actions">
        <button type="button" className="button button-secondary" onClick={() => navigate("/admin")}>
          Cancel
        </button>
        <button type="submit" className="button button-primary">
          {mode === "create" ? "Publish Event" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
