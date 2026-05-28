import { Check, Circle, Lock } from "lucide-react";
import { getTierProgress, type PricingTier as PricingTierType } from "../data/events";

type PricingTierProps = {
  tier: PricingTierType;
  active: boolean;
};

export default function PricingTier({ tier, active }: PricingTierProps) {
  const complete = tier.sold >= tier.capacity;
  const progress = getTierProgress(tier);
  const Icon = complete ? Check : active ? Circle : Lock;

  return (
    <article className={`pricing-tier ${active ? "active" : ""} ${complete ? "complete" : ""}`}>
      <div className={`tier-icon tier-${tier.color}`}>
        <Icon size={15} />
      </div>
      <div className="tier-main">
        <div className="tier-title-row">
          <strong>{tier.name}</strong>
          {active && <span className="mini-badge">Live</span>}
        </div>
        <span className="muted">
          {tier.sold}/{tier.capacity} sold
        </span>
        <div className="small-progress" aria-hidden="true">
          <span className={`tier-${tier.color}`} style={{ width: `${progress}%` }} />
        </div>
      </div>
      <strong className="tier-price">${tier.price}</strong>
    </article>
  );
}
