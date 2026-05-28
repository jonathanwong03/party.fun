import type { EventStatus } from "../data/events";

const labels: Record<EventStatus, string> = {
  draft: "Draft",
  live: "Live",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
