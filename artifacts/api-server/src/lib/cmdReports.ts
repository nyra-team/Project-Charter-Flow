// The CMD's direct reports — the 13 CXOs / function heads of the leadership
// team, plus the CMD themselves. Codes are the master-DB `employees.employee_code`
// (or `contractual_employees` for the CS-prefixed code).
//
// This list is the canonical leadership roster mirrored from the suite-wide SSOT
// (packages/shared/data/swotViewers.js in the platform repo). The PMO app is an
// independent repo, so the roster is duplicated here intentionally — keep the two
// in sync when a leader joins/leaves. Names/roles render even if the master-DB
// enrichment (designation/email/photo) is unavailable.

export type LeaderSeed = { code: string; name: string; role: string };

/** The CMD — root of the org chart. */
export const CMD: LeaderSeed = {
  code: "784",
  name: "Krishna Prasad Chigurupati",
  role: "Chairman & Managing Director",
};

/** The 13 leaders who report directly to the CMD. */
export const CMD_REPORTS: LeaderSeed[] = [
  { code: "13188",  name: "Ramraj Rangarajalu",                role: "President – FD Operations" },
  { code: "13944",  name: "PN Baskaran (Baskaran Pagadala)",   role: "President – API Operations" },
  { code: "2798",   name: "Murali Mohan Raju Gottumukkala",    role: "API Quality Head" },
  { code: "13516",  name: "CG Ramesh (Ramesh C. Govindaraju)", role: "FD Quality Head" },
  { code: "10693",  name: "Mukesh Surana",                     role: "Chief Financial Officer" },
  { code: "14915",  name: "Vinod Parur (Vinodkumar Parur)",    role: "Chief Human Resources Officer" },
  { code: "15227",  name: "Tushar Zade",                       role: "Chief Transformation Officer" },
  { code: "14450",  name: "Karthick Raja S",                   role: "Chief Information & Digital Officer" },
  { code: "1103",   name: "Khaleel Shaik",                     role: "Head of Commercials – Sales & Marketing" },
  { code: "4720",   name: "Manikandan Ramalingam",             role: "Head of Formulations R&D" },
  { code: "14019",  name: "Srinivasu Metlapalli",              role: "Head of EHS & Sustainability" },
  { code: "14994",  name: "Vinoth Kumar V",                    role: "Head of Supply Chain Management" },
  { code: "CS0011", name: "Vijay Ramanavarapu",                role: "President – Granules Pharmaceuticals Inc. (GPI)" },
];
