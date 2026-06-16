import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";

// A user-defined field added on step 2 of the Charter / e-NFA forms. Persisted
// as a JSONB array (custom_fields) on pmo_charters / pmo_nfas, rendered on the
// detail view after the standard sections.
export type CustomField = { id: string; label: string; value: string };

export function newCustomField(): CustomField {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { id, label: "", value: "" };
}

function SortableField({
  field, onChange, onRemove,
}: {
  field: CustomField;
  onChange: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-start gap-2 rounded-lg border bg-card p-2.5 ${isDragging ? "border-primary/50 shadow-lg" : "border-border"}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="mt-1 shrink-0 cursor-grab active:cursor-grabbing rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors touch-none"
      >
        <GripVertical size={15} />
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Field label (e.g. Regulatory Considerations)"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-semibold text-foreground placeholder:text-muted-foreground/60 placeholder:font-normal focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <textarea
          value={field.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Field content…"
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Remove field"
        aria-label="Remove field"
        className="mt-1 shrink-0 rounded p-1 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/**
 * Draggable list of user-added fields for the Charter / e-NFA step-2 forms.
 * "Add field" appends a blank field; drag the handle to reorder anywhere.
 */
export function CustomFieldsEditor({
  fields, onChange,
}: {
  fields: CustomField[];
  onChange: (next: CustomField[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const add = () => onChange([...fields, newCustomField()]);
  const update = (id: string, patch: Partial<CustomField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => onChange(fields.filter((f) => f.id !== id));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(fields, oldIndex, newIndex));
  };

  return (
    <div className="space-y-2">
      {fields.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No additional fields. Add your own sections — they'll be saved with this document and can be dragged into any order.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {fields.map((f) => (
                <SortableField
                  key={f.id}
                  field={f}
                  onChange={(patch) => update(f.id, patch)}
                  onRemove={() => remove(f.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors"
      >
        <Plus size={13} /> Add field
      </button>
    </div>
  );
}
