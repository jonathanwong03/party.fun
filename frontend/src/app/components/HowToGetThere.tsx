import { Car, Bus, TrainFront, Footprints, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

// Google Maps travel modes. Bus & Train both route via Google's combined
// "transit" mode (Google then lists bus + train options in the results).
const MODES = [
  { label: "Car", mode: "driving", Icon: Car },
  { label: "Bus", mode: "transit", Icon: Bus },
  { label: "Train", mode: "transit", Icon: TrainFront },
  { label: "Walk", mode: "walking", Icon: Footprints },
] as const;

// An underlined "How to get there?" link that opens a modal with an embedded
// venue map and buttons that open Google Maps directions (per mode) in a new tab.
export function HowToGetThere({ destination }: { destination: string }) {
  const dest = destination.trim();
  if (!dest) return null;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapSrc = apiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(dest)}`
    : null;
  const dirUrl = (mode: string) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=${mode}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-1 text-xs underline underline-offset-2 transition hover:text-white"
          style={{ color: "var(--muted-foreground)" }}
        >
          How to get there?
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>How to get there?</DialogTitle>
          <DialogDescription>{dest}</DialogDescription>
        </DialogHeader>

        {mapSrc ? (
          <iframe
            title="Venue location"
            src={mapSrc}
            className="h-64 w-full rounded-xl border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div
            className="grid h-64 w-full place-items-center rounded-xl text-sm"
            style={{ background: "var(--surface-2)", color: "var(--muted-foreground)" }}
          >
            Map unavailable
          </div>
        )}

        <div>
          <div
            className="mb-2 text-xs uppercase tracking-wider"
            style={{ color: "var(--muted-foreground)" }}
          >
            Get directions
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MODES.map(({ label, mode, Icon }) => (
              <a
                key={label}
                href={dirUrl(mode)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition hover:bg-white/5"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                <Icon size={20} />
                {label}
              </a>
            ))}
          </div>
          <div
            className="mt-2 flex items-center justify-center gap-1 text-[11px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            <ExternalLink size={11} /> Opens Google Maps in a new tab
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
