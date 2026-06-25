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

export function universityLabel(code?: string | null): string {
  const trimmed = code?.trim();
  if (!trimmed) return "";
  const match = UNIVERSITIES.find((u) => u.code === trimmed);
  return match ? `${match.name} (${match.code})` : trimmed;
}
