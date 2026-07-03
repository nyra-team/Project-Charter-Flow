import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";

export type EmployeeHit = { code: string | null; name: string; email: string | null; designation: string | null };

/**
 * Searchable typeahead over the FULL master employee directory.
 * Server-side search (/api/employees/search) — cmdk's local filter is OFF so
 * results come straight from the DB; every employee is reachable by typing.
 */
export function EmployeeCombobox({
  value,
  onSelect,
  placeholder = "Select member…",
  trigger,
}: {
  value?: string;
  onSelect: (hit: EmployeeHit) => void;
  placeholder?: string;
  /** Custom trigger element (e.g. a compact table-cell control). Falls back to
   *  the default bordered combobox button when omitted. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/employees/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        setHits(r.ok ? await r.json() : []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250); // ponytail: debounce typeahead; 250ms is the usual sweet spot
    return () => clearTimeout(timer.current);
  }, [q, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="h-9 flex-1 inline-flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-left hover:bg-accent/50"
        >
          <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
          <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
        </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search all employees…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : "No employee found."}</CommandEmpty>
            {hits.map((h) => (
              <CommandItem
                key={h.code ?? h.email ?? h.name}
                value={h.code ?? h.name}
                onSelect={() => {
                  onSelect(h);
                  setOpen(false);
                }}
              >
                <Check size={14} className={`mr-2 ${value === h.name ? "opacity-100" : "opacity-0"}`} />
                <span className="flex flex-col">
                  <span className="text-sm">{h.name}</span>
                  {(h.designation || h.email) && (
                    <span className="text-[10.5px] text-muted-foreground truncate">
                      {[h.designation, h.email].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
