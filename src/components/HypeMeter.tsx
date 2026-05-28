import { getHypePercent, type PartyEvent } from "../data/events";
import StatusBadge from "./StatusBadge";

type HypeMeterProps = {
  event: PartyEvent;
  compact?: boolean;
};

export default function HypeMeter({ event, compact = false }: HypeMeterProps) {
  const percent = getHypePercent(event);
  const confirmed = event.status === "confirmed" || percent >= 100;

  return (
    <section className={compact ? "hype-meter compact" : "hype-meter"} aria-label={`${event.title} hype meter`}>
      <div className="hype-meter-header">
        <div>
          <p className="eyebrow">Hype meter</p>
          <strong className={confirmed ? "hype-percent confirmed" : "hype-percent"}>{percent}%</strong>
          <span className="muted">
            {event.pledged} of {event.threshold} backers
          </span>
        </div>
        <StatusBadge status={event.status} />
      </div>
      <div className="meter-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span className={confirmed ? "meter-fill confirmed" : "meter-fill"} style={{ width: `${percent}%` }} />
      </div>
      <div className="meter-scale">
        <span>0</span>
        <span>{event.threshold} needed</span>
      </div>
    </section>
  );
}
