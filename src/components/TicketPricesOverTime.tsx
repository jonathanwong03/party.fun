import type { PartyEvent } from "../data/events";

export default function TicketPricesOverTime({ event }: { event: PartyEvent }) {
  return (
    <section className="ticket-prices" aria-label="Ticket prices over time">
      <p className="eyebrow">Ticket prices over time</p>
      <div className="tier-strip">
        {event.tiers.map((tier) => (
          <span className={`tier-strip-segment tier-${tier.color}`} key={tier.id}>
            ${tier.price}
            {tier.kind === "final" ? " flat" : ""}
          </span>
        ))}
      </div>
    </section>
  );
}
