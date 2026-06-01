// Shared form validators + message helpers, reused across Checkout, Create Event,
// Register User and Register Admin so every form behaves identically.

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
