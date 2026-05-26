import { getStatusMeta, getPriorityMeta, getRagColor, TASK_STATUSES, TASK_PRIORITIES, RAG_OPTIONS } from "../lib/task-constants";

export function TaskStatusChip({ status }: { status: string }) {
  const meta = getStatusMeta(status);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-none text-xs font-semibold whitespace-nowrap"
      style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40` }}
    >
      {meta.label}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: string }) {
  const meta = getPriorityMeta(priority);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-none text-xs font-bold whitespace-nowrap"
      style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40` }}
    >
      {meta.label}
    </span>
  );
}

export function RagDot({ rag }: { rag: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ background: getRagColor(rag) }}
      title={rag}
    />
  );
}

export function StatusSelect({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="text-xs rounded-none px-2 font-semibold border-0 outline-none cursor-pointer appearance-none w-full h-full text-center"
      style={{
        background: getStatusMeta(value).bg,
        color: getStatusMeta(value).color,
        minWidth: 110,
      }}
    >
      {TASK_STATUSES.map(s => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

export function PrioritySelect({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="text-xs rounded-none px-2 font-bold border-0 outline-none cursor-pointer appearance-none w-full h-full text-center"
      style={{
        background: getPriorityMeta(value).bg,
        color: getPriorityMeta(value).color,
        minWidth: 90,
      }}
    >
      {TASK_PRIORITIES.map(p => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  );
}

export function RagSelect({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="text-xs rounded border px-1.5 py-0.5 outline-none cursor-pointer"
      style={{ minWidth: 70 }}
    >
      {RAG_OPTIONS.map(r => (
        <option key={r.value} value={r.value}>{r.label}</option>
      ))}
    </select>
  );
}
