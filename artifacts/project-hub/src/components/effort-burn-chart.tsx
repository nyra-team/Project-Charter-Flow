import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Flame } from "lucide-react";

type EffortBurn = {
  weeks: Array<{ week: string; actual: number; cumulativeActual: number; planned: number }>;
  totalPlanned: number;
  totalActual: number;
};

export function EffortBurnChart({ projectId }: { projectId: number }) {
  const { data } = useQuery({
    queryKey: ["/api/projects", projectId, "effort-burn"],
    queryFn: () => customFetch<EffortBurn>(`/api/projects/${projectId}/effort-burn`),
  });

  const eb = data as EffortBurn | undefined;
  const totalPlanned = eb?.totalPlanned ?? 0;
  const totalActual = eb?.totalActual ?? 0;
  const pct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const over = totalActual > totalPlanned && totalPlanned > 0;

  return (
    <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Flame size={14} className={over ? "text-red-500" : "text-orange-500"} /> Effort Burn
          </h4>
          <p className="text-xs text-gray-400 mt-0.5">Cumulative actual vs planned hours (weekly)</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold" style={{ color: over ? "#DC2626" : "#4338CA" }}>{totalActual.toFixed(1)}h</p>
          <p className="text-xs text-gray-500">of {totalPlanned}h planned · {pct}%</p>
        </div>
      </div>

      {!eb || eb.weeks.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No time logged yet on this project.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={eb.weeks} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748B" }} />
            <YAxis tick={{ fontSize: 11, fill: "#64748B" }} label={{ value: "hours", angle: -90, position: "insideLeft", fill: "#94A3B8", fontSize: 11 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8F0" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={totalPlanned} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: "planned", fontSize: 10, fill: "#94A3B8", position: "right" }} />
            <Line type="monotone" dataKey="cumulativeActual" stroke="#6366F1" strokeWidth={2.5} dot={{ r: 3 }} name="Cumulative actual" />
            <Line type="monotone" dataKey="actual" stroke="#F59E0B" strokeWidth={1.5} dot={{ r: 2 }} name="Per-week actual" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
