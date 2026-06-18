import { FlaskConical } from "lucide-react";
import { DashboardCard } from "../components/dashboard/primitives";
import { CIP_DATA } from "../data/cip-data";

// CIP — Special Projects timelines. Read-only snapshot of the CIP tracker
// (formulation development → AMV → exhibit/stability → filing/approval) for
// the special pharma projects. Static data lives in data/cip-data.ts.

const { headers, sla, responsible, projects, notes, version } = CIP_DATA;

export default function AdminCip() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <FlaskConical size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">CIP — Special Projects Timelines</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Formulation development, AMV, exhibit batches, stability and filing timelines for the CIP special projects. {version}.
          </p>
        </div>
      </div>

      <DashboardCard title="Project Timelines" subtitle={`${projects.length} projects`}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-muted/60">
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="border border-border px-2 py-1.5 text-left font-semibold text-foreground align-top whitespace-pre-line min-w-[110px] first:min-w-[40px] [&:nth-child(2)]:min-w-[220px] last:min-w-[200px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-amber-50/60">
                {sla.map((c, i) => (
                  <td key={i} className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-muted-foreground italic">
                    {i === 0 ? <span className="font-semibold not-italic text-foreground">SLA</span> : c}
                  </td>
                ))}
              </tr>
              <tr className="bg-blue-50/50">
                {responsible.map((c, i) => (
                  <td key={i} className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-muted-foreground">
                    {i === 0 ? <span className="font-semibold text-foreground">Primary responsible</span> : c}
                  </td>
                ))}
              </tr>
              {projects.map((row, ri) => (
                <tr key={ri} className={ri % 2 ? "bg-card" : "bg-muted/20"}>
                  {row.map((c, ci) => (
                    <td
                      key={ci}
                      className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-foreground [&:nth-child(2)]:font-medium"
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {notes.length > 0 && (
        <DashboardCard title="Notes & Legend">
          <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-5">
            {notes.map((n, i) => (
              <li key={i} className="whitespace-pre-line">{n}</li>
            ))}
          </ul>
        </DashboardCard>
      )}
    </div>
  );
}
