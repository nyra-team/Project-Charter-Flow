import { useState } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Save, Trash2, RotateCcw, ChevronDown, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { SavedView } from "../hooks/use-user-view";

/**
 * Saved-views dropdown — drop next to any filter bar. The owning surface
 * holds the live config; this component just orchestrates discovery
 * (pick / save / delete / set default / reset) and calls back via the hook
 * the caller already has.
 *
 * Render shape is intentionally compact (1 trigger button + 1 dropdown) so
 * it co-exists with existing filter UIs without crowding them.
 */
export function ViewsMenu<TConfig extends Record<string, unknown>>({
  views,
  activeView,
  setActive,
  setDefault,
  deleteView,
  saveAs,
  currentConfig,
  triggerLabel = "Views",
}: {
  views: SavedView[];
  activeView: SavedView | null;
  setActive: (id: number | null) => void;
  setDefault: (id: number) => Promise<void>;
  deleteView: (id: number) => Promise<void>;
  saveAs: (key: string, config: TConfig, options?: { setDefault?: boolean }) => Promise<SavedView>;
  currentConfig: TConfig;
  triggerLabel?: string;
}) {
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveAs(name.trim(), currentConfig, { setDefault: makeDefault });
      toast({ title: "View saved", description: `“${name.trim()}” will load next time you open this page.` });
      setSaveOpen(false);
      setName("");
      setMakeDefault(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCurrent() {
    if (!activeView) return;
    setSaving(true);
    try {
      await saveAs(activeView.key, currentConfig, { setDefault: activeView.isDefault });
      toast({ title: "View updated", description: `“${activeView.key}” saved with current settings.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm border border-border bg-card hover:bg-accent transition-colors"
            data-testid="btn-views-menu"
          >
            <Eye size={14} />
            <span className="font-medium">
              {activeView ? activeView.key : triggerLabel}
            </span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground italic">
              No saved views yet. Adjust the filters / columns, then choose Save as new view.
            </div>
          ) : (
            views.map((v) => (
              <DropdownMenuCheckboxItem
                key={v.id}
                checked={activeView?.id === v.id}
                onCheckedChange={(checked) => setActive(checked ? v.id : null)}
              >
                <span className="flex-1 truncate">{v.key}</span>
                {v.isDefault && <Star size={12} className="text-amber-500 ml-2 shrink-0" />}
              </DropdownMenuCheckboxItem>
            ))
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <Save size={12} className="mr-2" />
            Save as new view…
          </DropdownMenuItem>

          {activeView && (
            <>
              <DropdownMenuItem onSelect={handleSaveCurrent} disabled={saving}>
                <Save size={12} className="mr-2" />
                Save changes to “{activeView.key}”
              </DropdownMenuItem>

              {!activeView.isDefault && (
                <DropdownMenuItem
                  onSelect={async () => {
                    await setDefault(activeView.id);
                    toast({ title: "Default set", description: `“${activeView.key}” will load on next visit.` });
                  }}
                >
                  <Star size={12} className="mr-2" />
                  Set as default
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onSelect={() => setActive(null)}
                className="text-muted-foreground"
              >
                <RotateCcw size={12} className="mr-2" />
                Clear selection
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={async () => {
                  if (!confirm(`Delete view "${activeView.key}"?`)) return;
                  await deleteView(activeView.id);
                  toast({ title: "View deleted" });
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 size={12} className="mr-2" />
                Delete view…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save-as-new dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current settings as a view</DialogTitle>
            <DialogDescription>
              Captures all current filters, sort, and column visibility on this page. Next time you visit, pick the view from
              the menu to restore them — or check "Make default" so it loads automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="view-name">View name</Label>
              <Input
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Critical only · Q1 push · My team"
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="make-default" checked={makeDefault} onCheckedChange={(c) => setMakeDefault(c === true)} />
              <Label htmlFor="make-default" className="text-sm cursor-pointer">
                Make this my default view on this page
              </Label>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSaveOpen(false)}
              className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save view"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
