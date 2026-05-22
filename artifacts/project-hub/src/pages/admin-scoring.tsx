import { useState, useMemo } from "react";
import {
  useListScoringCriteria,
  useCreateScoringCriteria,
  useUpdateScoringCriteria,
  useDeleteScoringCriteria,
  useListProjects,
  useListProjectScores,
  useCreateProjectScore,
  useUpdateProjectScore,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserStore } from "../lib/store";

type Criterion = { id: number; name: string; weightPct: number; description?: string | null; isActive?: boolean };

function WeightBar({ pct }: { pct: number }) {
  const color = pct > 40 ? "#EF4444" : pct > 25 ? "#F59E0B" : "#6366F1";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-10 text-right" style={{ color }}>{pct}%</span>
    </div>
  );
}

function ProjectScoringModal({
  project,
  criteria,
  onClose,
}: {
  project: { id: number; name: string };
  criteria: Criterion[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: scores } = useListProjectScores(project.id);
  const createScore = useCreateProjectScore();
  const updateScore = useUpdateProjectScore();
  const [localScores, setLocalScores] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const existingScoreMap = useMemo(() => {
    const map: Record<number, { id: number; score: number }> = {};
    (scores ?? []).forEach(s => { map[s.criterionId] = { id: s.id, score: s.score }; });
    return map;
  }, [scores]);

  const getScore = (criterionId: number) =>
    localScores[criterionId] ?? existingScoreMap[criterionId]?.score ?? 3;

  const totalWeighted = useMemo(() => {
    return criteria.reduce((sum, c) => {
      const score = getScore(c.id);
      return sum + (score * c.weightPct / 100);
    }, 0);
  }, [criteria, localScores, existingScoreMap]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [criterionIdStr, score] of Object.entries(localScores)) {
        const criterionId = Number(criterionIdStr);
        const existing = existingScoreMap[criterionId];
        if (existing) {
          await updateScore.mutateAsync({ id: existing.id, data: { score } });
        } else {
          await createScore.mutateAsync({ id: project.id, data: { criterionId, score } });
        }
      }
      await qc.invalidateQueries({ queryKey: ["/api/projects", project.id, "scores"] });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div className="p-6 border-b" style={{ borderColor: "#E2E8F0" }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900">Score Project</h3>
              <p className="text-sm text-gray-500 mt-0.5 truncate max-w-[300px]">{project.name}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={16} className="text-gray-500" />
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {criteria.map(c => (
            <div key={c.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex-1 min-w-0 mr-3">
                  <p className="text-sm font-semibold text-gray-800">{c.name}</p>
                  {c.description && <p className="text-xs text-gray-400 mt-0.5">{c.description}</p>}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{c.weightPct}% weight</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-10">1 (Low)</span>
                <div className="flex-1 flex gap-1">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      onClick={() => setLocalScores(s => ({ ...s, [c.id]: v }))}
                      className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
                      style={{
                        background: getScore(c.id) === v ? "linear-gradient(135deg,#6366F1,#8B5CF6)" : "#F8FAFC",
                        color: getScore(c.id) === v ? "white" : "#94A3B8",
                        border: `1px solid ${getScore(c.id) === v ? "#6366F1" : "#E2E8F0"}`,
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-400 w-12 text-right">5 (High)</span>
              </div>
              <div className="text-xs text-gray-400 mt-1 text-right">
                Weighted: <span className="font-semibold text-indigo-600">{(getScore(c.id) * c.weightPct / 100).toFixed(2)}</span>
              </div>
            </div>
          ))}

          <div className="rounded-xl p-4 mt-4" style={{ background: "linear-gradient(135deg,#EEF2FF,#E0E7FF)" }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-indigo-800">Total Weighted Score</span>
              <span className="text-2xl font-bold text-indigo-600">{totalWeighted.toFixed(2)}</span>
            </div>
            <p className="text-xs text-indigo-500 mt-1">
              Max possible: {criteria.reduce((s, c) => s + c.weightPct / 100 * 5, 0).toFixed(2)}
            </p>
          </div>
        </div>
        <div className="p-6 border-t flex justify-end gap-3" style={{ borderColor: "#E2E8F0" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl font-medium transition-colors"
            style={{ background: "#F8FAFC", color: "#64748B", border: "1px solid #E2E8F0" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || Object.keys(localScores).length === 0}
            className="px-4 py-2 text-sm rounded-xl font-semibold text-white flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save Scores"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PMO_ROLES = new Set(["pmo", "executive_director", "chairman"]);

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "#FEF2F2" }}>
        <span className="text-2xl">🔒</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900">Access Restricted</h2>
      <p className="text-sm text-gray-500 text-center max-w-sm">
        The Scoring Configuration page is only accessible to <strong>PMO</strong>, <strong>Executive Director</strong>, or <strong>Chairman</strong> roles.
      </p>
      <p className="text-xs text-gray-400">Switch your role using the Simulate Role selector in the sidebar.</p>
    </div>
  );
}

function AdminScoringInner() {
  const { role } = useUserStore();
  const qc = useQueryClient();
  const { data: criteria, isLoading } = useListScoringCriteria();
  const { data: projects } = useListProjects();
  const createCriterion = useCreateScoringCriteria();
  const updateCriterion = useUpdateScoringCriteria();
  const deleteCriterion = useDeleteScoringCriteria();

  const [editing, setEditing] = useState<Record<number, Partial<Criterion>>>({});
  const [newRow, setNewRow] = useState<{ name: string; weightPct: number; description: string } | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [scoringProject, setScoringProject] = useState<{ id: number; name: string } | null>(null);

  const isPMO = ["pmo", "executive_director", "chairman"].includes(role);

  const totalWeight = useMemo(() => {
    return (criteria ?? []).reduce((sum, c) => sum + (editing[c.id]?.weightPct ?? c.weightPct), 0);
  }, [criteria, editing]);

  const handleEdit = (id: number, field: keyof Criterion, value: string | number) => {
    setEditing(e => ({ ...e, [id]: { ...e[id], [field]: value } }));
  };

  const handleSave = async (criterion: Criterion) => {
    const changes = editing[criterion.id];
    if (!changes) return;
    setSaving(s => ({ ...s, [criterion.id]: true }));
    try {
      await updateCriterion.mutateAsync({ id: criterion.id, data: changes as never });
      setEditing(e => { const next = { ...e }; delete next[criterion.id]; return next; });
      await qc.invalidateQueries({ queryKey: ["/api/scoring-criteria"] });
    } finally {
      setSaving(s => ({ ...s, [criterion.id]: false }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this scoring criterion? This cannot be undone.")) return;
    await deleteCriterion.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: ["/api/scoring-criteria"] });
  };

  const handleAddNew = async () => {
    if (!newRow?.name) return;
    await createCriterion.mutateAsync({ data: { name: newRow.name, weightPct: newRow.weightPct, description: newRow.description } });
    setNewRow(null);
    await qc.invalidateQueries({ queryKey: ["/api/scoring-criteria"] });
  };

  const activeProjects = (projects ?? []).filter(p => p.status === "active");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Scoring Configuration</h2>
          <p className="text-sm text-gray-500 mt-0.5">Configure weighted scoring criteria for project prioritization</p>
        </div>
        {isPMO && (
          <button
            onClick={() => setNewRow({ name: "", weightPct: 0, description: "" })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
          >
            <Plus size={14} /> Add Criterion
          </button>
        )}
      </div>

      {!isPMO && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">You have read-only access. Switch to PMO or Executive Director role to edit criteria.</p>
        </div>
      )}

      {/* Criteria Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="p-5 border-b flex items-center justify-between" style={{ borderColor: "#F1F5F9" }}>
          <div>
            <h3 className="font-semibold text-gray-900">Scoring Criteria</h3>
            <p className="text-xs text-gray-400 mt-0.5">All weights must sum to 100%</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: Math.abs(totalWeight - 100) < 1 ? "#10B981" : "#EF4444" }}>
              Total: {totalWeight}%
            </span>
            {Math.abs(totalWeight - 100) < 1 ? (
              <CheckCircle2 size={16} className="text-green-500" />
            ) : (
              <AlertTriangle size={16} className="text-red-500" />
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider" style={{ background: "#F8FAFC" }}>
                <th className="px-5 py-3 text-left font-semibold">Criterion</th>
                <th className="px-5 py-3 text-left font-semibold">Description</th>
                <th className="px-5 py-3 text-left font-semibold w-48">Weight %</th>
                {isPMO && <th className="px-5 py-3 text-right font-semibold w-24">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "#F8FAFC" }}>
              {/* Add new row */}
              {newRow && (
                <tr style={{ background: "#F0FDF4" }}>
                  <td className="px-5 py-3">
                    <input
                      value={newRow.name}
                      onChange={e => setNewRow(r => r ? { ...r, name: e.target.value } : r)}
                      placeholder="Criterion name"
                      className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-300"
                      style={{ borderColor: "#E2E8F0" }}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <input
                      value={newRow.description}
                      onChange={e => setNewRow(r => r ? { ...r, description: e.target.value } : r)}
                      placeholder="Optional description"
                      className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-300"
                      style={{ borderColor: "#E2E8F0" }}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <div className="space-y-1">
                      <input
                        type="number" min={0} max={100}
                        value={newRow.weightPct}
                        onChange={e => setNewRow(r => r ? { ...r, weightPct: Number(e.target.value) } : r)}
                        className="w-24 text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-300"
                        style={{ borderColor: "#E2E8F0" }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={handleAddNew}
                        disabled={!newRow.name}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50 transition-colors"
                        style={{ background: "#10B981" }}
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setNewRow(null)}
                        className="px-2 py-1.5 text-xs rounded-lg transition-colors"
                        style={{ background: "#F1F5F9", color: "#64748B" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {(criteria ?? []).length === 0 && !newRow ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No scoring criteria defined yet. Add criteria to enable project prioritization.
                  </td>
                </tr>
              ) : (criteria ?? []).map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    {isPMO ? (
                      <input
                        value={editing[c.id]?.name ?? c.name}
                        onChange={e => handleEdit(c.id, "name", e.target.value)}
                        className="w-full text-sm border-0 bg-transparent focus:bg-white focus:border focus:rounded-lg focus:px-2 focus:py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 font-medium text-gray-900"
                        style={{ borderColor: "#E2E8F0" }}
                      />
                    ) : (
                      <span className="font-medium text-gray-900">{c.name}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {isPMO ? (
                      <input
                        value={editing[c.id]?.description ?? (c.description ?? "")}
                        onChange={e => handleEdit(c.id, "description", e.target.value)}
                        placeholder="Description"
                        className="w-full text-xs border-0 bg-transparent focus:bg-white focus:border focus:rounded-lg focus:px-2 focus:py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 text-gray-500"
                      />
                    ) : (
                      c.description || "—"
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="space-y-1">
                      {isPMO ? (
                        <input
                          type="number" min={0} max={100}
                          value={editing[c.id]?.weightPct ?? c.weightPct}
                          onChange={e => handleEdit(c.id, "weightPct", Number(e.target.value))}
                          className="w-20 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 font-bold text-gray-700"
                          style={{ borderColor: "#E2E8F0" }}
                        />
                      ) : null}
                      <WeightBar pct={editing[c.id]?.weightPct ?? c.weightPct} />
                    </div>
                  </td>
                  {isPMO && (
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {editing[c.id] && (
                          <button
                            onClick={() => handleSave(c)}
                            disabled={saving[c.id]}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ background: "#ECFDF5", color: "#10B981" }}
                            title="Save"
                          >
                            {saving[c.id] ? "…" : <Save size={13} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
                          style={{ color: "#EF4444" }}
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Score Projects */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="p-5 border-b" style={{ borderColor: "#F1F5F9" }}>
          <h3 className="font-semibold text-gray-900">Score Active Projects</h3>
          <p className="text-xs text-gray-400 mt-0.5">Assign criteria scores to compute prioritization rank</p>
        </div>
        {activeProjects.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No active projects to score</div>
        ) : (
          <div className="divide-y" style={{ borderColor: "#F8FAFC" }}>
            {activeProjects.map(p => (
              <div key={p.id} className="px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div>
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400 capitalize">{p.status}</span>
                    {p.scoringTotal != null && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs font-bold text-indigo-600">Score: {Number(p.scoringTotal).toFixed(2)}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setScoringProject({ id: p.id, name: p.name })}
                  disabled={!criteria?.length}
                  className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)", color: "white" }}
                >
                  {p.scoringTotal != null ? "Update Scores" : "Score Project"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scoring Modal */}
      {scoringProject && criteria && (
        <ProjectScoringModal
          project={scoringProject}
          criteria={criteria}
          onClose={() => setScoringProject(null)}
        />
      )}
    </div>
  );
}

export default function AdminScoring() {
  const { role } = useUserStore();
  if (!PMO_ROLES.has(role)) return <AccessDenied />;
  return <AdminScoringInner />;
}
