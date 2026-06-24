import { useRef, useState } from "react";
import {
  ChevronLeft,
  Image as ImageIcon,
  AlertTriangle,
  X,
} from "lucide-react";
import { uploadEventImage } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { HypeMeter } from "../components/HypeMeter";
import { StatusBadge } from "../components/StatusBadge";
import { DeleteEventModal } from "../components/DeleteEventModal";
import {
  getActiveStatus,
  type EventItem,
  type Route,
  type EventStatus,
} from "../components/types";
import { NumberStepper } from "../components/NumberStepper";
import { DatePicker } from "../components/DatePicker";
import { TimePicker } from "../components/TimePicker";
import {
  required,
  dateError,
  timeError,
  deadlineError,
  priceError,
  scheduleError,
  deadlineEventError,
  futureDateTimeError,
} from "../components/validation";
import { DEFAULT_EVENT_IMAGE } from "../components/media";
import { AddressPicker } from "../components/AddressPicker";

export function CreateEvent({
  route,
  go,
  editId,
  events,
  onPublish,
  onCancel,
  onUpdate,
  draftId,
  drafts,
  onSaveDraft,
  onDeleteDraft,
}: {
  route: Route;
  go: (r: Route) => void;
  editId?: string;
  events?: EventItem[];
  onPublish?: (e: EventItem) => void;
  onCancel?: (id: string, reason: string) => void;
  onUpdate?: (e: EventItem) => void;
  draftId?: string;
  drafts?: EventItem[];
  onSaveDraft?: (e: EventItem) => void;
  onDeleteDraft?: (id: string) => void;
}) {
  const list = events ?? [];
  const existing = editId ? list.find((e) => e.id === editId) : undefined;
  const draftSource = draftId
    ? (drafts ?? []).find((d) => d.id === draftId)
    : undefined;
  const isEdit = !!existing;
  // The record used to pre-fill the form: an existing published event, or a draft being resumed.
  const source = existing ?? draftSource;

  const [title, setTitle] = useState(source?.title ?? "");
  const [organiser, setOrganiser] = useState(source?.organiser ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [venue, setVenue] = useState(source?.location.split(",")[0] ?? "");
  const [address, setAddress] = useState(source?.location ?? "");
  // Prefill the pickers in DD/MM/YYYY + H:MM AM/PM so the validators apply uniformly.
  // Seed/published events carry raw ISO (startsAt/endsAt/deadlineAt); drafts only the display strings.
  const [date, setDate] = useState(
    isoToDateInput(source?.startsAt) || source?.date || "",
  );
  const [start, setStart] = useState(
    isoToTimeInput(source?.startsAt) || source?.time || "",
  );
  const [end, setEnd] = useState(
    isoToTimeInput(source?.endsAt) || source?.endTime || "",
  );
  const [endDate, setEndDate] = useState(
    isoToDateInput(source?.endsAt) || source?.endDate || "",
  );
  // Deadline is split into a date + time picker; combined into "DD/MM/YYYY, H:MM AM/PM" on submit.
  const dl0 = source?.deadlineAt
    ? {
        d: isoToDateInput(source.deadlineAt),
        t: isoToTimeInput(source.deadlineAt),
      }
    : parseDeadline(source?.deadline);
  const [deadlineDate, setDeadlineDate] = useState(dl0.d);
  const [deadlineTime, setDeadlineTime] = useState(dl0.t);
  const deadline =
    deadlineDate || deadlineTime
      ? `${deadlineDate}, ${deadlineTime}`
      : (source?.deadline ?? "");
  const money = (n?: number) => (n != null ? n.toFixed(2) : "");
  // The Early Birds quantity doubles as the hype threshold; Greenlit adds the rest of capacity.
  const [ebPrice, setEbPrice] = useState<string>(
    money(source?.statuses[0]?.price) || "10.00",
  );
  const [ebQty, setEbQty] = useState<number>(
    source?.statuses[0]?.qty ?? source?.hypeThreshold ?? 150,
  );
  const [greenlitPrice, setGreenlitPrice] = useState<string>(
    money(source?.statuses[1]?.price) || "20.00",
  );
  const [greenlitQty, setGreenlitQty] = useState<number>(
    source?.statuses[1]?.qty ?? 150,
  );
  const maxCapacity = ebQty + greenlitQty;
  const [deleting, setDeleting] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [image, setImage] = useState<string>(source?.image ?? "");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageBusy(true);
    setImageError(null);
    try {
      setImage(await uploadEventImage(file));
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : "Unable to upload image.",
      );
    } finally {
      setImageBusy(false);
    }
  };

  const status: EventStatus = existing?.status ?? "early_bird";
  const locked = isEdit && status === "greenlit";

  // Price-format errors computed up front so the order check only runs once both are valid.
  const ebPErr = priceError(ebPrice);
  const greenlitPErr = priceError(greenlitPrice);

  const errs = {
    title: required(title),
    organiser: required(organiser),
    description: required(description),
    date: dateError(date),
    start: timeError(start),
    end: timeError(end),
    schedule: scheduleError(date, start, endDate, end),
    venue: required(venue),
    address: required(address),
    // Deadline is only validated when editable (greenlit events lock it, so no deadline checks).
    deadline: locked ? null : deadlineError(deadline),
    deadlineVsEvent: locked
      ? null
      : deadlineEventError(date, start, deadlineDate, deadlineTime),
    deadlineFuture: locked
      ? null
      : futureDateTimeError(deadlineDate, deadlineTime),
    ebP: ebPErr,
    greenlitP: greenlitPErr,
    // Greenlit price must be strictly higher than the Early Birds price (checked once both are valid).
    priceOrder:
      !ebPErr && !greenlitPErr && num(greenlitPrice) <= num(ebPrice)
        ? "Greenlit price must be higher than the Early Birds price."
        : null,
    // Start/end must be strictly in the future and end strictly after start (greenlit & non-greenlit).
    startFuture: futureDateTimeError(date, start),
    endFuture: futureDateTimeError(endDate, end),
  };
  // Dates are normalised to DD/MM/YYYY on prefill, so every check parses and runs in edit mode too.
  const errOf = (k: keyof typeof errs) => (showErrors ? errs[k] : null);
  const errStyle = (e: string | null): React.CSSProperties => ({
    ...fieldStyle,
    borderColor: e ? "#ff4d2e" : "var(--border)",
  });

  const handlePublish = () => {
    setShowErrors(true);
    if (Object.values(errs).some(Boolean)) return;
    const newEvent: EventItem = {
      id: `e${Date.now()}`,
      mine: true,
      title,
      organiser,
      date,
      time: start,
      endTime: end,
      endDate,
      startsAt: inputToIso(date, start),
      endsAt: inputToIso(endDate, end),
      deadlineAt: inputToIso(deadlineDate, deadlineTime),
      location: `${venue}, ${address}`,
      description,
      image,
      price: num(ebPrice),
      statusLabel: "Early Birds",
      hypePercentage: 0,
      hypeThreshold: ebQty,
      activeTicketCount: 0,
      maxCapacity,
      spotsLeft: maxCapacity,
      status: "early_bird",
      deadline,
      statuses: [
        {
          statusName: "early_bird",
          label: "Early Birds",
          price: num(ebPrice),
          qty: ebQty,
          sold: 0,
        },
        {
          statusName: "greenlit",
          label: "Greenlit",
          price: num(greenlitPrice),
          qty: greenlitQty,
          sold: 0,
        },
      ],
    };
    onPublish?.(newEvent);
    if (draftId) onDeleteDraft?.(draftId); // publishing a resumed draft removes it from Drafts
    go({ name: "hosted-events" });
  };

  // Save the in-progress form as a draft — no validation, fields may be partial.
  const handleSaveDraft = () => {
    const draft: EventItem = {
      id: draftId ?? `draft-${Date.now()}`,
      mine: true,
      title: title || "Untitled draft",
      organiser,
      date,
      time: start,
      endTime: end,
      endDate,
      location: `${venue}, ${address}`,
      description,
      image,
      price: num(ebPrice),
      statusLabel: "Early Birds",
      hypePercentage: 0,
      hypeThreshold: ebQty,
      activeTicketCount: 0,
      maxCapacity,
      spotsLeft: maxCapacity,
      status: "early_bird",
      deadline,
      statuses: [
        {
          statusName: "early_bird",
          label: "Early Birds",
          price: num(ebPrice),
          qty: ebQty,
          sold: 0,
        },
        {
          statusName: "greenlit",
          label: "Greenlit",
          price: num(greenlitPrice),
          qty: greenlitQty,
          sold: 0,
        },
      ],
    };
    onSaveDraft?.(draft);
    go({ name: "hosted-events", tab: "drafts" });
  };

  const handleSave = () => {
    if (!existing) return;
    // Block on any active error: text fields plus the schedule/future datetime checks and
    // (for non-greenlit) the deadline checks. errs is already gated by `locked`, so read it
    // directly here — errOf() depends on the not-yet-applied showErrors state.
    setShowErrors(true);
    if (Object.values(errs).some(Boolean)) return;
    const statuses = [
      {
        statusName: "early_bird" as const,
        label: "Early Birds",
        sold: existing.statuses[0]?.sold ?? 0,
        price: num(ebPrice),
        qty: ebQty,
      },
      {
        statusName: "greenlit" as const,
        label: "Greenlit",
        sold: existing.statuses[1]?.sold ?? 0,
        price: num(greenlitPrice),
        qty: greenlitQty,
      },
    ];
    const updated: EventItem = {
      ...existing,
      image,
      title,
      organiser,
      description,
      location: `${venue}, ${address}`,
      date,
      time: start,
      endTime: end,
      endDate,
      startsAt: inputToIso(date, start),
      endsAt: inputToIso(endDate, end),
      deadlineAt: inputToIso(deadlineDate, deadlineTime),
      maxCapacity,
      hypeThreshold: ebQty,
      deadline,
      spotsLeft: Math.max(0, maxCapacity - existing.activeTicketCount),
      statuses,
    };
    updated.price = updated.statuses[getActiveStatus(updated)].price;
    onUpdate?.(updated);
    go({ name: "hosted-events" });
  };

  return (
    <div>
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto max-w-[1536px]">
          <button
            onClick={() => go({ name: "hosted-events" })}
            className="mb-4 inline-flex items-center gap-1 text-sm hover:text-foreground"
            style={{ color: "var(--muted-foreground)" }}
          >
            <ChevronLeft size={14} /> Back to hosted events
          </button>

          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                {isEdit ? "Edit event" : "Create new event"}
              </h1>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--muted-foreground)" }}
              >
                {isEdit
                  ? "Update the details below. Changes are visible to attendees immediately."
                  : "Set up your event details, hype threshold and pricing statuses."}
              </p>
            </div>
            {isEdit && existing && (
              <div className="flex items-center gap-3">
                <span
                  className="text-xs"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Status
                </span>
                <StatusBadge event={existing} />
              </div>
            )}
          </div>

          {isEdit && status === "early_bird" && (
            <div
              className="mb-6 flex items-start gap-2 rounded-xl p-4 text-sm"
              style={{
                background: "rgba(255,203,60,0.10)",
                border: "1px solid rgba(255,203,60,0.35)",
                color: "#ffd968",
              }}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div style={{ fontWeight: 700 }}>This event is live</div>
                <div className="opacity-90">
                  Editing pricing or the hype threshold while people are
                  pledging may impact trust. Changes are logged.
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Section title="Basic details">
                <Field label="Event title" error={errOf("title")}>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Event title"
                    style={errStyle(errOf("title"))}
                  />
                </Field>
                <Field label="Organiser" error={errOf("organiser")}>
                  <Input
                    value={organiser}
                    onChange={(e) => setOrganiser(e.target.value)}
                    placeholder="Organisation name"
                    style={errStyle(errOf("organiser"))}
                  />
                </Field>
                <Field label="Description" error={errOf("description")}>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What's the vibe?"
                    rows={4}
                    style={errStyle(errOf("description"))}
                  />
                </Field>
                <Field label="Event image / banner" error={imageError}>
                  <input
                    ref={imageRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFile}
                  />
                  {image ? (
                    <div
                      className="relative overflow-hidden rounded-xl"
                      style={{ border: "1px solid var(--border)" }}
                    >
                      <img
                        src={image}
                        alt="Event banner"
                        className="h-40 w-full object-cover"
                      />
                      <div className="absolute right-2 top-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => imageRef.current?.click()}
                          disabled={imageBusy}
                          className="rounded-lg px-2.5 py-1 text-xs text-white"
                          style={{ background: "rgba(0,0,0,0.6)" }}
                        >
                          {imageBusy ? "Uploading…" : "Replace"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setImage("")}
                          className="grid size-7 place-items-center rounded-lg text-white"
                          style={{ background: "rgba(0,0,0,0.6)" }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => imageRef.current?.click()}
                      disabled={imageBusy}
                      className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left text-sm hover:bg-white/5"
                      style={{
                        borderColor: "var(--border-strong)",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      <ImageIcon size={18} />
                      <span>
                        {imageBusy
                          ? "Uploading…"
                          : "Click to upload (16:9 recommended)"}
                      </span>
                    </button>
                  )}
                </Field>
              </Section>

              <Section title="Schedule">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Start date"
                    error={errOf("date") || errOf("startFuture")}
                  >
                    <DatePicker
                      value={date}
                      onChange={setDate}
                      error={!!(errOf("date") || errOf("startFuture"))}
                    />
                  </Field>
                  <Field
                    label="Start time"
                    error={errOf("start") || errOf("startFuture")}
                  >
                    <TimePicker
                      value={start}
                      onChange={setStart}
                      error={!!(errOf("start") || errOf("startFuture"))}
                      placeholder="Start time"
                    />
                  </Field>
                  <Field
                    label="End date"
                    error={errOf("schedule") || errOf("endFuture")}
                  >
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      error={!!(errOf("schedule") || errOf("endFuture"))}
                    />
                  </Field>
                  <Field
                    label="End time"
                    error={
                      errOf("end") || errOf("schedule") || errOf("endFuture")
                    }
                  >
                    <TimePicker
                      value={end}
                      onChange={setEnd}
                      error={
                        !!(
                          errOf("end") ||
                          errOf("schedule") ||
                          errOf("endFuture")
                        )
                      }
                      placeholder="End time"
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Location">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Venue name" error={errOf("venue")}>
                    <Input
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      placeholder="Venue name"
                      style={errStyle(errOf("venue"))}
                    />
                  </Field>
                  <Field label="Address" error={errOf("address")}>
                    <AddressPicker
                      value={address}
                      onChange={setAddress}
                      error={!!errOf("address")}
                    />
                  </Field>{" "}
                </div>
              </Section>

              <Section title="Pricing statuses">
                {locked && (
                  <div
                    className="mb-3 rounded-lg p-2 text-xs"
                    style={{
                      background: "rgba(41,224,122,0.08)",
                      border: "1px solid rgba(41,224,122,0.25)",
                      color: "#a6f3c8",
                    }}
                  >
                    Pricing is locked — this event is greenlit.
                  </div>
                )}
                <div
                  className="mb-8 text-xs"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  The Early Birds quantity is the hype threshold — the minimum
                  viable attendance that confirms the event. Status quantities
                  set the maximum capacity of {maxCapacity}.
                </div>
                <StatusRow
                  label="Early Birds - Hype Threshold"
                  price={ebPrice}
                  qty={ebQty}
                  onPrice={setEbPrice}
                  onQty={setEbQty}
                  disabled={locked}
                  error={errOf("ebP")}
                />
                <StatusRow
                  label="Greenlit"
                  price={greenlitPrice}
                  qty={greenlitQty}
                  onPrice={setGreenlitPrice}
                  onQty={setGreenlitQty}
                  disabled={locked}
                  error={errOf("greenlitP") || errOf("priceOrder")}
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Deadline date"
                    error={
                      errOf("deadline") ||
                      errOf("deadlineVsEvent") ||
                      errOf("deadlineFuture")
                    }
                  >
                    <DatePicker
                      value={deadlineDate}
                      onChange={setDeadlineDate}
                      error={
                        !!(
                          errOf("deadline") ||
                          errOf("deadlineVsEvent") ||
                          errOf("deadlineFuture")
                        )
                      }
                      disabled={locked}
                    />
                  </Field>
                  <Field
                    label="Deadline time"
                    error={
                      errOf("deadline") ||
                      errOf("deadlineVsEvent") ||
                      errOf("deadlineFuture")
                    }
                  >
                    <TimePicker
                      value={deadlineTime}
                      onChange={setDeadlineTime}
                      error={
                        !!(
                          errOf("deadline") ||
                          errOf("deadlineVsEvent") ||
                          errOf("deadlineFuture")
                        )
                      }
                      placeholder="Deadline time"
                      disabled={locked}
                    />
                  </Field>
                </div>
              </Section>

              <div className="flex flex-wrap gap-3 pt-2">
                {isEdit ? (
                  <>
                    <Button
                      className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
                      style={{ borderRadius: 10, height: 44 }}
                      onClick={handleSave}
                    >
                      Save Changes
                    </Button>
                    <Button
                      variant="outline"
                      className="border-white/15 bg-transparent hover:bg-white/5"
                      style={{ borderRadius: 10, height: 44 }}
                      onClick={() => go({ name: "hosted-events" })}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        setCancelReason("");
                        setDeleting(true);
                      }}
                      className="ml-auto bg-[#ff3354] text-white hover:bg-[#ff4865]"
                      style={{ borderRadius: 10, height: 44 }}
                    >
                      Cancel Event
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="bg-[#ff4d2e] text-white hover:bg-[#ff6647]"
                      style={{ borderRadius: 10, height: 44 }}
                      onClick={handlePublish}
                    >
                      Publish Event
                    </Button>
                    <Button
                      variant="outline"
                      className="border-white/15 bg-transparent hover:bg-white/5"
                      style={{ borderRadius: 10, height: 44 }}
                      onClick={handleSaveDraft}
                    >
                      Save Draft
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Preview */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div
                className="rounded-2xl border p-5"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--surface)",
                }}
              >
                <div
                  className="mb-3 text-xs uppercase tracking-wider"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Preview
                </div>
                <div
                  className="overflow-hidden rounded-xl"
                  style={{ background: "var(--surface-2)" }}
                >
                  <img
                    src={image || DEFAULT_EVENT_IMAGE}
                    alt="Event banner preview"
                    className="h-32 w-full object-cover"
                  />
                  <div className="space-y-3 p-4">
                    <h3 className="line-clamp-2">
                      {title || "Your event title"}
                    </h3>
                    <div
                      className="text-xs"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {date || "Date"} · {venue || "Venue"}
                    </div>
                    <HypeMeter
                      pct={isEdit ? (existing?.hypePercentage ?? 0) : 0}
                      status={status}
                      statusIndex={0}
                      size="sm"
                    />
                    <div className="flex items-baseline justify-between">
                      <span
                        className="text-xs"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        From
                      </span>
                      <span style={{ fontWeight: 700 }}>${ebPrice}</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {deleting && existing && (
        <DeleteEventModal
          eventName={existing.title}
          title="Cancel Event?"
          leadIn="You're about to cancel"
          confirmWord="CONFIRM"
          actionLabel="Cancel Event"
          warning="All pledges will be voided and any captured funds refunded. Backers will be notified by email."
          reason={cancelReason}
          onReasonChange={setCancelReason}
          reasonPrompt="Why are you cancelling this event?"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            onCancel?.(existing.id, cancelReason);
            go({ name: "hosted-events" });
          }}
        />
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  borderColor: "var(--border)",
  height: 42,
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border p-6"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <h3 className="mb-4">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div>
      <Label
        className="mb-1.5 block text-xs"
        style={{ color: "var(--muted-foreground)" }}
      >
        {label}
      </Label>
      {children}
      {error && (
        <p className="mt-1 text-xs" style={{ color: "#ff9a82" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function StatusRow({
  label,
  price,
  qty,
  onPrice,
  onQty,
  disabled,
  error,
}: {
  label: string;
  price: string;
  qty: number;
  onPrice: (v: string) => void;
  onQty: (n: number) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_120px] items-end gap-3">
      <div
        className="text-sm"
        style={{ color: "var(--foreground)", fontWeight: 500 }}
      >
        {label}
      </div>
      <Field label="Price" error={error}>
        <PriceInput
          value={price}
          onChange={onPrice}
          disabled={disabled}
          error={!!error}
        />
      </Field>
      <Field label="Quantity">
        <NumberStepper
          value={qty}
          onChange={onQty}
          min={1}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

// $-prefixed price input that only accepts digits, one decimal point and at most 2 decimals.
function PriceInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const handle = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, "");
    const parts = v.split(".");
    if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join("")}`;
    const [intPart, dec] = v.split(".");
    onChange(dec !== undefined ? `${intPart}.${dec.slice(0, 2)}` : intPart);
  };
  return (
    <div
      className="flex items-center rounded-md border"
      style={{
        background: "var(--surface-2)",
        borderColor: error ? "#ff4d2e" : "var(--border)",
        height: 42,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="pl-3 pr-1 text-sm"
        style={{ color: "var(--muted-foreground)" }}
      >
        $
      </span>
      <input
        value={value}
        onChange={(e) => handle(e.target.value)}
        disabled={disabled}
        inputMode="decimal"
        placeholder="0.00"
        className="h-full w-full bg-transparent pr-3 text-sm outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

const num = (s: string) => parseFloat(s) || 0;

// Format a raw ISO datetime into the picker formats (Asia/Singapore) so the validators,
// which expect DD/MM/YYYY and H:MM AM/PM, apply uniformly to seed/published events.
function isoToDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
function isoToTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toUpperCase();
}

// Split a stored deadline string "DD/MM/YYYY, H:MM AM/PM" into its date + time parts.
// Human-readable seed deadlines (e.g. "Jun 10, 11:59 PM") don't match and yield empty parts.
function parseDeadline(s?: string): { d: string; t: string } {
  const m = /^(\d{1,2}\/\d{1,2}\/\d{4}),?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i.exec(
    (s ?? "").trim(),
  );
  return m ? { d: m[1], t: m[2].toUpperCase() } : { d: "", t: "" };
}

// Convert picker values "DD/MM/YYYY" + "H:MM AM/PM" to an ISO 8601 string in Asia/Singapore (+08:00).
function inputToIso(dateStr: string, timeStr: string): string {
  const dp = dateStr.split("/").map(Number);
  if (dp.length !== 3) return "";
  const [d, mo, y] = dp;
  const tm = /(\d+):(\d+)\s*(AM|PM)/i.exec(timeStr);
  if (!tm) return "";
  let h = parseInt(tm[1]);
  const min = parseInt(tm[2]);
  const ampm = tm[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+08:00`;
}
