export const UNIVERSITIES = [
  { code: "NUS", name: "National University of Singapore" },
  { code: "NTU", name: "Nanyang Technological University" },
  { code: "SMU", name: "Singapore Management University" },
  { code: "SUSS", name: "Singapore University of Social Sciences" },
  { code: "SUTD", name: "Singapore University of Technology and Design" },
  { code: "SIM", name: "Singapore Institute of Management" },
  { code: "SIT", name: "Singapore Institute of Technology" },
] as const;

export type UniversityCode = (typeof UNIVERSITIES)[number]["code"];

// party.fun is for CURRENT university students only, so every account carries a
// matriculation number: one letter, eight digits, one letter (e.g. A12345678B).
// Defined once here — the same rule is enforced by the DB (user_matric_format_check)
// and by validate_signup_identity, so all three must agree.
export const MATRIC_RX = /^[A-Za-z]\d{8}[A-Za-z]$/;
export const MATRIC_HINT = "e.g. A12345678B — one letter, 8 digits, one letter";

export function isValidMatric(value?: string | null): boolean {
  return MATRIC_RX.test(String(value ?? "").trim());
}

export function universityLabel(code?: string | null): string {
  const trimmed = code?.trim();
  if (!trimmed) return "";
  const match = UNIVERSITIES.find((u) => u.code === trimmed);
  return match ? `${match.name} (${match.code})` : trimmed;
}
