// Shared form validators + message helpers, reused across Checkout, Create Event,
// Register User and Register Organiser so every form behaves identically.

export const isBlank = (v: string) => v.trim() === '';

// Email: contains a single "@" (not as the first char) and ends in a domain like .com/.org.
export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v.trim());

// Date: DD/MM/YYYY (1- or 2-digit day/month) with a real calendar day.
export const isValidDate = (v: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return false;
  const day = +m[1];
  const month = +m[2];
  const year = +m[3];
  if (month < 1 || month > 12) return false;
  // new Date(year, month, 0) gives the last day of `month` — 29 for Feb in leap years, 28 otherwise.
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
};

// Expiry format: MM/YY — 1- or 2-digit month (1-12) and a strict 2-digit year (rejects 4-digit years).
export const isValidExpiry = (v: string) => {
  const m = /^(\d{1,2})\/(\d{2})$/.exec(v.trim());
  return !!m && +m[1] >= 1 && +m[1] <= 12;
};

// Expiry not yet passed: the current month counts as valid (e.g. 06/26 in June 2026).
export const isExpiryActive = (v: string) => {
  const m = /^(\d{1,2})\/(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const month = +m[1];
  const year = 2000 + +m[2];
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  return year > curYear || (year === curYear && month >= curMonth);
};

// Card: 16 digits, spaces optional/ignored.
export const isValidCard = (v: string) => /^\d{16}$/.test(v.replace(/\s/g, ''));

// CVC: exactly 3 digits.
export const isValidCVC = (v: string) => /^\d{3}$/.test(v.trim());

// Time: strictly 12-hour HH:MM AM/PM (e.g. "10:00 PM").
export const isValidTime = (v: string) => /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i.test(v.trim());

// Minutes since midnight for a 12-hour time string (e.g. "12:30 AM" -> 30).
const timeToMinutes = (v: string) => {
  const m = /^(\d{1,2}):([0-5]\d)\s?(AM|PM)$/i.exec(v.trim());
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + +m[2];
};

// End time may run past midnight (an earlier clock time = next day), so the only
// invalid case is an end equal to the start (a zero-length event).
export const endTimeError = (start: string, end: string) => {
  if (!isValidTime(start) || !isValidTime(end)) return null;
  return timeToMinutes(start) === timeToMinutes(end) ? 'End time cannot be the same as the start time.' : null;
};

// Combine a DD/MM/YYYY date and a H:MM AM/PM time into a Date (null if either is invalid).
const toDateTime = (date: string, time: string) => {
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  const t = timeToMinutes(time);
  if (!dm || t == null) return null;
  return new Date(+dm[3], +dm[2] - 1, +dm[1], Math.floor(t / 60), t % 60);
};

// The threshold deadline must fall on or before the event's start (date + start time).
export const deadlineEventError = (eventDate: string, startTime: string, deadlineDate: string, deadlineTime: string) => {
  const eventAt = toDateTime(eventDate, startTime);
  const deadlineAt = toDateTime(deadlineDate, deadlineTime);
  if (!eventAt || !deadlineAt) return null;
  return deadlineAt.getTime() > eventAt.getTime() ? 'Deadline must be on or before the event start.' : null;
};

// Deadline: a DD/MM/YYYY date and a 12-hour time, e.g. "10/06/2025, 11:59 PM".
export const isValidDeadline = (v: string) => {
  const m = /^(.+?),?\s+(\d{1,2}:[0-5]\d\s?(?:AM|PM))$/i.exec(v.trim());
  if (!m) return false;
  return isValidDate(m[1]) && isValidTime(m[2]);
};

// True when a valid DD/MM/YYYY date is strictly after today (tomorrow or later).
export const isFutureDate = (v: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return false;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() > today.getTime();
};

// True when the date portion of a valid deadline string is strictly after today.
export const isDeadlineFuture = (v: string) => {
  const m = /^(.+?),?\s+\d{1,2}:[0-5]\d\s?(?:AM|PM)$/i.exec(v.trim());
  return !!m && isFutureDate(m[1]);
};

export const required = (v: string) => (isBlank(v) ? 'This field is required.' : null);

export const emailError = (v: string) =>
  isBlank(v) ? 'This field is required.' : isValidEmail(v) ? null : 'Enter a valid email address.';

export const dateError = (v: string) =>
  isBlank(v) ? 'This field is required.'
    : !isValidDate(v) ? 'Enter a valid date in the format DD/MM/YYYY.'
    : !isFutureDate(v) ? 'Please select a date that is after today.'
    : null;

export const timeError = (v: string) =>
  isBlank(v) ? 'This field is required.' : isValidTime(v) ? null : 'Enter a valid time in the format HH:MM AM/PM.';

export const deadlineError = (v: string) =>
  isBlank(v) ? 'This field is required.'
    : !isValidDeadline(v) ? 'Enter a valid date and time in the format DD/MM/YYYY, HH:MM AM/PM.'
    : !isDeadlineFuture(v) ? 'Please select a date that is after today.'
    : null;

export const cardError = (v: string) =>
  isBlank(v) ? 'This field is required.' : isValidCard(v) ? null : 'Enter a valid 16-digit card number.';

export const expiryError = (v: string) =>
  isBlank(v) ? 'This field is required.'
    : !isValidExpiry(v) ? 'Enter a valid date in the format MM/YY.'
    : !isExpiryActive(v) ? 'Card has expired.'
    : null;

export const cvcError = (v: string) =>
  isBlank(v) ? 'This field is required.' : isValidCVC(v) ? null : 'Enter a valid 3-digit CVC.';

export const confirmError = (pw: string, c: string) =>
  isBlank(c) ? 'This field is required.' : c !== pw ? 'Passwords do not match.' : null;

// Matric / Student ID: one letter, one-or-more digits, one trailing letter (e.g. A0234567X).
export const isValidMatric = (v: string) => /^[A-Za-z]\d+[A-Za-z]$/.test(v.trim());

export const matricError = (v: string) =>
  isBlank(v) ? 'This field is required.'
    : isValidMatric(v) ? null
    : 'Format: a letter, digits, then a letter (e.g. A0234567X).';

// Price: a number with strictly two decimal places (e.g. 8.95, 1.00, 25.67).
export const isValidPrice = (v: string) => /^\d+\.\d{2}$/.test(v.trim());

export const priceError = (v: string) =>
  isBlank(v) ? 'This field is required.'
    : isValidPrice(v) ? null
    : 'Enter a price with 2 decimals (e.g. 8.95).';
