import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ArrowLeft, KeyRound, Lock, Sparkles, Send, ShieldCheck, AlertOctagon } from "lucide-react";

type RfxBundle = {
  event: {
    id: number; type: string; title: string; summary: string | null; brief: string | null;
    status: string; closesAt: string | null; currency: string;
    blindGrading: boolean; evaluationThresholdPct: number;
    awardRationale: string | null;
  };
  invitations: Array<{ id: number; vendorId: number; status: string; submittedAt: string | null }>;
  questions: Array<{ id: number; section: string; label: string; kind: string; weight: number; required: boolean; order: number }>;
  dimensions: Array<{ id: number; label: string; kind: string; weight: number }>;
  envelopes: Array<{ id: number; invitationId: number; kind: string; status: string; labelAlias: string | null; submittedAt: string | null; openedAt: string | null }>;
  clarifications: Array<{ id: number; question: string; answer: string | null; isPublic: boolean; fromRole: string }>;
  awards: Array<{ id: number; vendorId: number; sharePct: number; value: string; rationale: string }>;
};

type Vendor = { id: number; name: string; segment: string };

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-blue-500/15 text-blue-700",
  closed: "bg-amber-500/15 text-amber-700",
  evaluating: "bg-violet-500/15 text-violet-700",
  awarded: "bg-emerald-500/15 text-emerald-700",
  cancelled: "bg-rose-500/15 text-rose-700",
};

export default function RfxDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["rfx", id],
    queryFn: () => api.get<RfxBundle>(`/api/rfx/${id}`),
    enabled: Number.isFinite(id),
    refetchInterval: 15_000,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => api.get<Vendor[]>("/api/vendors"),
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/api/rfx/${id}/publish`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", id] }); toast({ title: "RFx published" }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Publish failed", description: e.message }),
  });

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const e = data.event;
  const past = e.closesAt ? new Date() >= new Date(e.closesAt) : false;
  const vendorById = new Map(vendors.map(v => [v.id, v]));

  return (
    <div className="p-6 space-y-5">
      <Link href="/rfx" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
        <ArrowLeft size={12} /> Back to RFx
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.title}</h1>
          <p className="text-sm text-muted-foreground">{e.type.toUpperCase()} • {e.currency}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge className={STATUS_TONE[e.status] ?? ""}>{e.status}</Badge>
            {e.closesAt && <Badge variant="outline">closes {new Date(e.closesAt).toLocaleString()}</Badge>}
            {e.blindGrading && <Badge variant="outline">blind grading</Badge>}
            <Badge variant="outline">commercial gate {e.evaluationThresholdPct}%</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {e.status === "draft" && <Button onClick={() => publish.mutate()}>Publish</Button>}
        </div>
      </div>

      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="questions">Questions ({data.questions.length})</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensions ({data.dimensions.length})</TabsTrigger>
          <TabsTrigger value="vendors">Vendors ({data.invitations.length})</TabsTrigger>
          <TabsTrigger value="bids">Bids ({data.envelopes.length})</TabsTrigger>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="award">Award</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-3 text-sm">
            {e.summary && <p className="text-muted-foreground">{e.summary}</p>}
            <pre className="whitespace-pre-wrap font-sans text-sm">{e.brief || "No brief yet."}</pre>
          </div>
        </TabsContent>

        <TabsContent value="questions">
          <QuestionsPanel rfxId={id} questions={data.questions} editable={e.status === "draft"} />
        </TabsContent>

        <TabsContent value="dimensions">
          <DimensionsPanel rfxId={id} dimensions={data.dimensions} editable={e.status === "draft"} />
        </TabsContent>

        <TabsContent value="vendors">
          <VendorsPanel rfxId={id} invitations={data.invitations} allVendors={vendors} eventStatus={e.status} />
        </TabsContent>

        <TabsContent value="bids">
          <BidsPanel rfxId={id} envelopes={data.envelopes} invitations={data.invitations} vendorById={vendorById} past={past} />
        </TabsContent>

        <TabsContent value="scoring">
          <ScoringPanel rfxId={id} envelopes={data.envelopes} dimensions={data.dimensions} blind={e.blindGrading} />
        </TabsContent>

        <TabsContent value="award">
          <AwardPanel rfxId={id} bundle={data} vendorById={vendorById} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditPanel rfxId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuestionsPanel({ rfxId, questions, editable }: { rfxId: number; questions: RfxBundle["questions"]; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [list, setList] = useState(questions);
  const save = useMutation({
    mutationFn: () => api.post(`/api/rfx/${rfxId}/questions`, { questions: list.map((q, i) => ({ ...q, order: i })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", rfxId] }); toast({ title: "Questions saved" }); },
  });
  const draftQ = useMutation({
    mutationFn: async () => {
      const brief = prompt("Paste the RFx brief to auto-draft questions") || "";
      if (!brief.trim()) return null;
      return await api.post<{ questions: typeof questions }>("/api/ai/rfx/draft-questions", { brief, type: "rfp" });
    },
    onSuccess: (r) => {
      if (!r) return;
      setList([...list, ...r.questions.map((q, i) => ({ ...q, id: -1 - i, order: list.length + i, weight: q.weight ?? 5 }))] as RfxBundle["questions"]);
      toast({ title: `Drafted ${r.questions.length} questions — review and Save` });
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {editable && (
          <>
            <Button size="sm" variant="outline" disabled={draftQ.isPending} onClick={() => draftQ.mutate()}>
              <Sparkles size={12} className="mr-1.5" /> AI draft
            </Button>
            <Button size="sm" onClick={() => setList([...list, { id: -Date.now(), section: "technical", label: "", kind: "text", weight: 5, required: false, order: list.length }])}>+ Add</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </>
        )}
      </div>
      <div className="space-y-2">
        {list.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
            <select disabled={!editable} value={q.section} onChange={e => updateAt(setList, list, i, { section: e.target.value })} className="md:col-span-2 h-9 rounded-md border border-input bg-background px-2 text-xs">
              <option value="technical">Technical</option><option value="commercial">Commercial</option><option value="qualification">Qualification</option>
            </select>
            <Input disabled={!editable} className="md:col-span-5" value={q.label} onChange={e => updateAt(setList, list, i, { label: e.target.value })} placeholder="Question label" />
            <select disabled={!editable} value={q.kind} onChange={e => updateAt(setList, list, i, { kind: e.target.value })} className="md:col-span-2 h-9 rounded-md border border-input bg-background px-2 text-xs">
              {["text", "number", "select", "multi", "file", "bool", "currency"].map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <Input disabled={!editable} type="number" className="md:col-span-2" value={q.weight} onChange={e => updateAt(setList, list, i, { weight: Number(e.target.value) })} />
            {editable && <button onClick={() => setList(list.filter((_, j) => j !== i))} className="md:col-span-1 text-muted-foreground hover:text-destructive text-xs">×</button>}
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground text-center p-6">No questions yet.</p>}
      </div>
    </div>
  );
}

function DimensionsPanel({ rfxId, dimensions, editable }: { rfxId: number; dimensions: RfxBundle["dimensions"]; editable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [list, setList] = useState(dimensions);
  const save = useMutation({
    mutationFn: () => api.post(`/api/rfx/${rfxId}/dimensions`, { dimensions: list.map(d => ({ label: d.label, kind: d.kind, weight: d.weight })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", rfxId] }); toast({ title: "Dimensions saved" }); },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {editable && <>
          <Button size="sm" onClick={() => setList([...list, { id: -Date.now(), label: "", kind: "technical", weight: 10 }])}>+ Add</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </>}
      </div>
      <div className="space-y-2">
        {list.map((d, i) => (
          <div key={d.id} className="rounded-xl border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
            <Input disabled={!editable} className="md:col-span-7" value={d.label} onChange={e => updateAt(setList, list, i, { label: e.target.value })} />
            <select disabled={!editable} value={d.kind} onChange={e => updateAt(setList, list, i, { kind: e.target.value })} className="md:col-span-2 h-9 rounded-md border border-input bg-background px-2 text-xs">
              <option value="technical">Technical</option><option value="commercial">Commercial</option>
            </select>
            <Input disabled={!editable} type="number" min={0} max={100} className="md:col-span-2" value={d.weight} onChange={e => updateAt(setList, list, i, { weight: Number(e.target.value) })} />
            {editable && <button onClick={() => setList(list.filter((_, j) => j !== i))} className="md:col-span-1 text-muted-foreground hover:text-destructive text-xs">×</button>}
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground text-center p-6">No dimensions yet.</p>}
      </div>
    </div>
  );
}

function VendorsPanel({ rfxId, invitations, allVendors, eventStatus }: { rfxId: number; invitations: RfxBundle["invitations"]; allVendors: Vendor[]; eventStatus: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const invite = useMutation({
    mutationFn: () => api.post(`/api/rfx/${rfxId}/invitations`, { vendorIds: Array.from(picked) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", rfxId] }); setPicked(new Set()); toast({ title: "Invitations sent" }); },
  });
  const invited = new Set(invitations.map(i => i.vendorId));
  const available = allVendors.filter(v => !invited.has(v.id) && v.segment !== "blocked");
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Invited ({invitations.length})</h3>
        {invitations.length === 0 ? <p className="text-xs text-muted-foreground">No vendors invited yet.</p> : (
          <div className="space-y-1">
            {invitations.map(inv => {
              const v = allVendors.find(x => x.id === inv.vendorId);
              return (
                <div key={inv.id} className="rounded-lg border border-border p-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{v?.name ?? `Vendor #${inv.vendorId}`}</span>
                  <Badge variant="outline" className="text-xs">{inv.status}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {eventStatus === "open" || eventStatus === "draft" ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">Available vendors</h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {available.map(v => (
              <label key={v.id} className="rounded-lg border border-border p-2 flex items-center gap-2 text-sm cursor-pointer hover:bg-card/40">
                <input type="checkbox" checked={picked.has(v.id)} onChange={() => {
                  const n = new Set(picked); n.has(v.id) ? n.delete(v.id) : n.add(v.id);
                  setPicked(n);
                }} />
                <span className="flex-1">{v.name}</span>
                <Badge variant="outline" className="text-xs">{v.segment}</Badge>
              </label>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <Button disabled={picked.size === 0 || invite.isPending} onClick={() => invite.mutate()}>
              <Send size={12} className="mr-1.5" /> Invite {picked.size > 0 ? `(${picked.size})` : ""}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BidsPanel({ rfxId, envelopes, invitations, vendorById, past }: {
  rfxId: number; envelopes: RfxBundle["envelopes"]; invitations: RfxBundle["invitations"]; vendorById: Map<number, Vendor>; past: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const release = useMutation({
    mutationFn: ({ kind, side }: { kind: string; side: "a" | "b" }) =>
      api.post<{ opened: number; releasedAt: string | null; awaiting?: string }>(`/api/rfx/${rfxId}/envelopes/${kind}/release-share`, { side }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["rfx", rfxId] });
      toast({
        title: r.releasedAt ? `Opened ${r.opened} ${vars.kind} envelopes` : `Share ${vars.side.toUpperCase()} recorded, awaiting share ${r.awaiting?.toUpperCase()}`,
      });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Unlock failed", description: e.message }),
  });

  const groups: Record<string, RfxBundle["envelopes"]> = { technical: [], commercial: [], alternative: [] };
  for (const env of envelopes) (groups[env.kind] ||= []).push(env);

  return (
    <div className="space-y-5">
      {!past && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-2 text-sm">
          <Lock size={14} className="text-amber-700" />
          <span>Envelopes sealed until <strong>closes_at</strong>. Vendors can still submit; nothing can be opened yet.</span>
        </div>
      )}
      {(["technical", "commercial", "alternative"] as const).map(kind => (
        <div key={kind} className="rounded-2xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase">{kind} envelopes ({groups[kind].length})</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" disabled={!past || release.isPending} onClick={() => release.mutate({ kind, side: "a" })}>
                <KeyRound size={12} className="mr-1.5" /> Release share A (SCM)
              </Button>
              <Button size="sm" variant="outline" disabled={!past || release.isPending} onClick={() => release.mutate({ kind, side: "b" })}>
                <KeyRound size={12} className="mr-1.5" /> Release share B (PMO)
              </Button>
            </div>
          </div>
          {groups[kind].length === 0 ? <p className="text-xs text-muted-foreground">No {kind} envelopes submitted yet.</p> : (
            <div className="space-y-1">
              {groups[kind].map(env => {
                const inv = invitations.find(i => i.id === env.invitationId);
                const v = inv ? vendorById.get(inv.vendorId) : null;
                return (
                  <div key={env.id} className="rounded-lg border border-border p-2 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{env.labelAlias || v?.name || `Envelope #${env.id}`}</span>
                      <Badge variant="outline" className="text-xs">{env.status}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{env.submittedAt ? new Date(env.submittedAt).toLocaleString() : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ScoringPanel({ rfxId, envelopes, dimensions, blind }: { rfxId: number; envelopes: RfxBundle["envelopes"]; dimensions: RfxBundle["dimensions"]; blind: boolean }) {
  const { data: scores = [] } = useQuery({
    queryKey: ["rfx", rfxId, "scores"],
    queryFn: () => api.get<Array<{ id: number; envelopeId: number; dimensionId: number; score: number; rationale: string; graderAlias: string }>>(`/api/rfx/${rfxId}/scores`),
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useMutation({
    mutationFn: (body: { envelopeId: number; dimensionId: number; score: number }) => api.post(`/api/rfx/${rfxId}/scores`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", rfxId, "scores"] }); toast({ title: "Score saved" }); },
  });

  const openEnvelopes = envelopes.filter(e => e.status === "opened");
  if (openEnvelopes.length === 0) return <p className="p-6 text-sm text-muted-foreground text-center">No envelopes opened yet. Unlock from the Bids tab first.</p>;
  if (dimensions.length === 0) return <p className="p-6 text-sm text-muted-foreground text-center">No scoring dimensions defined. Add them from the Dimensions tab.</p>;

  return (
    <div className="space-y-4">
      {blind && <p className="text-xs text-muted-foreground">Blind grading is on — vendor identities are hidden under aliases.</p>}
      {openEnvelopes.map(env => (
        <div key={env.id} className="rounded-2xl border border-border bg-card/40 p-4 space-y-2">
          <h3 className="text-sm font-semibold">{env.labelAlias || `Envelope #${env.id}`} <Badge variant="outline" className="ml-2 text-xs">{env.kind}</Badge></h3>
          <div className="space-y-2">
            {dimensions.filter(d => d.kind === env.kind || env.kind === "alternative").map(d => {
              const existing = scores.find(s => s.envelopeId === env.id && s.dimensionId === d.id);
              return (
                <div key={d.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  <span className="md:col-span-6 text-sm">{d.label} <span className="text-xs text-muted-foreground">({d.weight}%)</span></span>
                  <Input type="number" min={0} max={100} defaultValue={existing?.score ?? ""} className="md:col-span-2"
                    onBlur={e => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      submit.mutate({ envelopeId: env.id, dimensionId: d.id, score: v });
                    }} />
                  <span className="md:col-span-4 text-xs text-muted-foreground truncate">{existing?.graderAlias ?? ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function AwardPanel({ rfxId, bundle, vendorById }: { rfxId: number; bundle: RfxBundle; vendorById: Map<number, Vendor> }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [allocations, setAllocations] = useState<Array<{ vendorId: number; sharePct: number; value: number; rationale: string }>>([]);
  const aiScenarios = useMutation({
    mutationFn: () => api.post<{ scenarios: Array<{ name: string; rationale: string; allocation: Array<{ vendorId: number; sharePct: number }>; indicativeTotal: number | null }> }>(
      "/api/ai/rfx/award-scenarios",
      { vendors: bundle.invitations.map(i => ({ id: i.vendorId, name: vendorById.get(i.vendorId)?.name ?? `V${i.vendorId}` })), dimensions: bundle.dimensions, scores: [], tcoModel: {} }
    ),
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/api/rfx/${rfxId}/award`, { awards: allocations, awardRationale: "Award decided in PMO" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rfx", rfxId] }); toast({ title: "Award recorded" }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Award failed", description: e.message }),
  });
  const totalShare = allocations.reduce((s, a) => s + a.sharePct, 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={aiScenarios.isPending} onClick={() => aiScenarios.mutate()}>
          <Sparkles size={12} className="mr-1.5" /> AI scenarios
        </Button>
      </div>
      {aiScenarios.data && (
        <div className="space-y-2">
          {aiScenarios.data.scenarios.map((s, i) => (
            <div key={i} className="rounded-xl border border-border p-3 cursor-pointer hover:border-primary/40" onClick={() => setAllocations(s.allocation.map(a => ({ ...a, value: 0, rationale: s.rationale })))}>
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.rationale}</p>
              <div className="text-xs mt-1">{s.allocation.map(a => `${vendorById.get(a.vendorId)?.name ?? "?"} ${a.sharePct}%`).join("  •  ")}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card/40 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Final allocation</h3>
          <span className="text-xs">Total {totalShare}%</span>
        </div>
        {allocations.length === 0 ? <p className="text-xs text-muted-foreground">No allocations. Pick an AI scenario or add manually.</p> : (
          <div className="space-y-1">
            {allocations.map((a, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                <span className="md:col-span-5 text-sm">{vendorById.get(a.vendorId)?.name ?? `V${a.vendorId}`}</span>
                <Input type="number" min={0} max={100} value={a.sharePct} className="md:col-span-2" onChange={e => updateAt(setAllocations, allocations, i, { sharePct: Number(e.target.value) })} />
                <Input type="number" min={0} value={a.value} className="md:col-span-3" onChange={e => updateAt(setAllocations, allocations, i, { value: Number(e.target.value) })} placeholder="Value" />
                <button className="md:col-span-2 text-xs text-muted-foreground" onClick={() => setAllocations(allocations.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button disabled={totalShare > 100 || allocations.length === 0 || submit.isPending} onClick={() => submit.mutate()}>
            <ShieldCheck size={12} className="mr-1.5" /> Submit award
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuditPanel({ rfxId }: { rfxId: number }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["rfx", rfxId, "audit"],
    queryFn: () => api.get<Array<{ id: number; event: string; actorEmployeeId: string | null; payload: Record<string, unknown>; createdAt: string }>>(`/api/rfx/${rfxId}/audit`),
  });
  if (rows.length === 0) return <p className="p-6 text-sm text-muted-foreground text-center">No audit events yet.</p>;
  return (
    <div className="rounded-2xl border border-border overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="text-left p-3">Event</th><th className="text-left p-3">Actor</th><th className="text-left p-3">Payload</th><th className="text-left p-3">When</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-3 font-mono text-xs">{r.event}</td>
              <td className="p-3 text-xs text-muted-foreground">{r.actorEmployeeId || "—"}</td>
              <td className="p-3 text-xs text-muted-foreground font-mono"><code>{JSON.stringify(r.payload)}</code></td>
              <td className="p-3 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function updateAt<T>(setter: (next: T[]) => void, list: T[], i: number, patch: Partial<T>) {
  setter(list.map((x, j) => j === i ? { ...x, ...patch } : x));
}
