import { Link } from "wouter";
import { useGetProject, useGetCharter } from "@workspace/api-client-react";
import { FileText, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";

export function CharterSection({ projectId }: { projectId: number }) {
  const { data: project } = useGetProject(projectId);
  const { data: charter } = useGetCharter(project?.charterId ?? 0, {
    query: { enabled: !!project?.charterId },
  }) as { data?: { id: number; title?: string; status?: string; tentativeBudget?: number; function?: string } };

  const hasCharter = !!project?.charterId && !!charter;

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: "linear-gradient(135deg,#FEF2F2,#FEE2E2)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-red-700" />
          <div>
            <p className="text-sm font-bold text-red-900">Project Charter</p>
            <p className="text-[11px] text-red-700">FR-08 · formal charter for PMO + Dept Head sign-off</p>
          </div>
        </div>
        <span className={`text-[10px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${hasCharter ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {hasCharter ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
          {hasCharter ? "Linked" : "Not linked"}
        </span>
      </div>

      {hasCharter ? (
        <div className="rounded-xl p-3 border-2 border-red-200 bg-white space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-red-900">{charter.title ?? `Charter #${charter.id}`}</p>
              <p className="text-[11px] text-red-700">Function: {charter.function ?? "—"}</p>
            </div>
            <Link href={`/charters/${charter.id}`} className="text-[11px] inline-flex items-center gap-1 text-red-700 font-semibold hover:underline">
              Open Charter <ExternalLink size={11} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-red-50 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-red-600">Status</p>
              <p className="font-semibold text-red-900 capitalize">{charter.status ?? "draft"}</p>
            </div>
            <div className="rounded-lg bg-red-50 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-red-600">Budget (USD)</p>
              <p className="font-mono font-semibold text-red-900">
                {charter.tentativeBudget != null ? Number(charter.tentativeBudget).toLocaleString() : "—"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3 border-2 border-dashed border-red-300 bg-white text-center space-y-2">
          <p className="text-xs text-red-900">
            No charter is linked to this project yet. Create the full Charter (with strategic scoring, benefits and team) to advance past this stage.
          </p>
          <Link href="/charters/new" className="inline-flex items-center gap-1 text-xs font-semibold text-white px-3 py-1.5 rounded-lg" style={{ background: "#EF4444" }}>
            Create Charter <ExternalLink size={11} />
          </Link>
        </div>
      )}
    </div>
  );
}
