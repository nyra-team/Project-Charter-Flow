import { useState } from "react";
import { useParams } from "wouter";
import { useGoBack } from "../lib/back";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShieldAlert, FileText, Award, Activity, TrendingUp, Sparkles } from "lucide-react";

type VendorBundle = {
  vendor: {
    id: number; name: string; legalName: string | null; gst: string | null;
    pan: string | null; country: string | null; region: string | null; category: string | null;
    email: string | null; phone: string | null; website: string | null; address: string | null;
    sapVendorCode: string | null; segment: string; riskStatus: string;
  };
  documents: Array<{ id: number; kind: string; originalName: string | null; verifiedAt: string | null; createdAt: string }>;
  qualifications: Array<{ id: number; category: string; region: string | null; status: string; decidedAt: string | null }>;
  kpis: Array<{ id: number; period: string; compositeScore: number | null; onTimeDeliveryPct: number | null; qualityPct: number | null; invoiceAccuracyPct: number | null; responsivenessPct: number | null }>;
  riskEvents: Array<{ id: number; source: string; severity: string; summary: string; resolvedAt: string | null; createdAt: string }>;
  questionnaireResponses: Array<{ id: number; templateId: number; submittedAt: string }>;
};

const SEGMENT_TONE: Record<string, string> = {
  strategic: "bg-violet-500/15 text-violet-700",
  preferred: "bg-emerald-500/15 text-emerald-700",
  approved: "bg-blue-500/15 text-blue-700",
  provisional: "bg-amber-500/15 text-amber-700",
  blocked: "bg-rose-500/15 text-rose-700",
};

const RISK_TONE: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-700",
  amber: "bg-amber-500/15 text-amber-700",
  red: "bg-rose-500/15 text-rose-700",
  unknown: "bg-muted text-muted-foreground",
};

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const goBack = useGoBack();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data } = useQuery({
    queryKey: ["vendor", id],
    queryFn: () => api.get<VendorBundle>(`/api/vendors/${id}`),
    enabled: Number.isFinite(id),
  });

  const changeSegment = useMutation({
    mutationFn: (seg: string) => api.post(`/api/vendors/${id}/segment`, { segment: seg }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", id] }); toast({ title: "Segment updated" }); },
  });
  const setRisk = useMutation({
    mutationFn: (r: string) => api.post(`/api/vendors/${id}/risk-status`, { riskStatus: r }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", id] }); toast({ title: "Risk status updated" }); },
  });

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const v = data.vendor;
  return (
    <div className="p-6 space-y-5">
      <button onClick={() => goBack("/vendors")} className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
        <ArrowLeft size={12} /> Back
      </button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{v.name}</h1>
          {v.legalName ? <p className="text-sm text-muted-foreground">{v.legalName}</p> : null}
          <div className="flex items-center gap-2 mt-2">
            <Badge className={SEGMENT_TONE[v.segment] ?? ""}>{v.segment}</Badge>
            <Badge className={RISK_TONE[v.riskStatus] ?? ""}>risk: {v.riskStatus}</Badge>
            {v.sapVendorCode ? <Badge variant="outline" className="font-mono">{v.sapVendorCode}</Badge> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={v.segment}
            onChange={e => changeSegment.mutate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="provisional">Provisional</option>
            <option value="approved">Approved</option>
            <option value="preferred">Preferred</option>
            <option value="strategic">Strategic</option>
            <option value="blocked">Blocked</option>
          </select>
          <select
            value={v.riskStatus}
            onChange={e => setRisk.mutate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="unknown">unknown</option>
            <option value="green">green</option>
            <option value="amber">amber</option>
            <option value="red">red</option>
          </select>
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="documents">Documents ({data.documents.length})</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications ({data.qualifications.length})</TabsTrigger>
          <TabsTrigger value="kpis">KPIs ({data.kpis.length})</TabsTrigger>
          <TabsTrigger value="risk">Risk ({data.riskEvents.filter(e => !e.resolvedAt).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="rounded-2xl border border-border bg-card/40 p-5 grid grid-cols-2 gap-3 text-sm">
            <KV k="Category" v={v.category} />
            <KV k="Region" v={v.region} />
            <KV k="Country" v={v.country} />
            <KV k="GST" v={v.gst} mono />
            <KV k="PAN" v={v.pan} mono />
            <KV k="Email" v={v.email} />
            <KV k="Phone" v={v.phone} />
            <KV k="Website" v={v.website} />
            <KV k="SAP code" v={v.sapVendorCode} mono />
            <div className="col-span-2"><KV k="Address" v={v.address} /></div>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel vendorId={id} documents={data.documents} />
        </TabsContent>

        <TabsContent value="qualifications">
          <QualificationsPanel vendorId={id} qualifications={data.qualifications} />
        </TabsContent>

        <TabsContent value="kpis">
          <KpisPanel vendorId={id} kpis={data.kpis} />
        </TabsContent>

        <TabsContent value="risk">
          <RiskPanel vendorId={id} events={data.riskEvents} vendorName={v.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{v || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function DocumentsPanel({ vendorId, documents }: { vendorId: number; documents: VendorBundle["documents"] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const verify = useMutation({
    mutationFn: (docId: number) => api.post(`/api/vendors/${vendorId}/documents/${docId}/verify`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", vendorId] }); toast({ title: "Document verified" }); },
  });
  if (documents.length === 0) return <Empty icon={FileText} title="No documents uploaded" />;
  return (
    <div className="rounded-2xl border border-border overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">Kind</th>
            <th className="text-left p-3">File</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3"></th>
          </tr>
        </thead>
        <tbody>
          {documents.map(d => (
            <tr key={d.id} className="border-t border-border">
              <td className="p-3 capitalize">{d.kind}</td>
              <td className="p-3 text-muted-foreground">{d.originalName || `Doc #${d.id}`}</td>
              <td className="p-3">
                {d.verifiedAt
                  ? <Badge className="bg-emerald-500/15 text-emerald-700">verified</Badge>
                  : <Badge className="bg-amber-500/15 text-amber-700">pending</Badge>}
              </td>
              <td className="p-3 text-right">
                {!d.verifiedAt && <Button size="sm" variant="outline" onClick={() => verify.mutate(d.id)}>Verify</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualificationsPanel({ vendorId, qualifications }: { vendorId: number; qualifications: VendorBundle["qualifications"] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ category: "", region: "", businessUnit: "", status: "qualified" });

  const decide = useMutation({
    mutationFn: () => api.post(`/api/vendors/${vendorId}/qualifications`, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      toast({ title: "Qualification decided" });
      setOpen(false); setDraft({ category: "", region: "", businessUnit: "", status: "qualified" });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(o => !o)}>{open ? "Cancel" : "+ Decide qualification"}</Button>
      </div>
      {open && (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 grid grid-cols-2 gap-3">
          <Field2 label="Category *" v={draft.category} onChange={v => setDraft({ ...draft, category: v })} />
          <Field2 label="Region" v={draft.region} onChange={v => setDraft({ ...draft, region: v })} />
          <Field2 label="Business unit" v={draft.businessUnit} onChange={v => setDraft({ ...draft, businessUnit: v })} />
          <div className="space-y-1">
            <Label>Decision</Label>
            <select
              value={draft.status}
              onChange={e => setDraft({ ...draft, status: e.target.value })}
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="qualified">Qualified</option>
              <option value="disqualified">Disqualified</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="col-span-2 flex justify-end">
            <Button disabled={!draft.category || decide.isPending} onClick={() => decide.mutate()}>Save decision</Button>
          </div>
        </div>
      )}
      {qualifications.length === 0 ? <Empty icon={Award} title="No qualifications recorded" /> : (
        <div className="rounded-2xl border border-border overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left p-3">Category</th><th className="text-left p-3">Region</th><th className="text-left p-3">Status</th><th className="text-left p-3">Decided</th></tr>
            </thead>
            <tbody>
              {qualifications.map(q => (
                <tr key={q.id} className="border-t border-border">
                  <td className="p-3">{q.category}</td>
                  <td className="p-3 text-muted-foreground">{q.region || "—"}</td>
                  <td className="p-3"><Badge>{q.status}</Badge></td>
                  <td className="p-3 text-xs text-muted-foreground">{q.decidedAt ? new Date(q.decidedAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpisPanel({ vendorId, kpis }: { vendorId: number; kpis: VendorBundle["kpis"] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ period: "", onTimeDeliveryPct: 0, invoiceAccuracyPct: 0, qualityPct: 0, responsivenessPct: 0 });
  const ingest = useMutation({
    mutationFn: () => api.post(`/api/vendors/${vendorId}/kpis`, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor", vendorId] });
      toast({ title: "KPI recorded" });
      setOpen(false); setDraft({ period: "", onTimeDeliveryPct: 0, invoiceAccuracyPct: 0, qualityPct: 0, responsivenessPct: 0 });
    },
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(o => !o)}>{open ? "Cancel" : "+ Record KPI"}</Button>
      </div>
      {open && (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Field2 label="Period (YYYY-MM)" v={draft.period} onChange={v => setDraft({ ...draft, period: v })} />
          <NumField label="On-time %" v={draft.onTimeDeliveryPct} onChange={v => setDraft({ ...draft, onTimeDeliveryPct: v })} />
          <NumField label="Invoice acc %" v={draft.invoiceAccuracyPct} onChange={v => setDraft({ ...draft, invoiceAccuracyPct: v })} />
          <NumField label="Quality %" v={draft.qualityPct} onChange={v => setDraft({ ...draft, qualityPct: v })} />
          <NumField label="Responsiveness %" v={draft.responsivenessPct} onChange={v => setDraft({ ...draft, responsivenessPct: v })} />
          <div className="col-span-2 sm:col-span-3 lg:col-span-5 flex justify-end">
            <Button disabled={!draft.period || ingest.isPending} onClick={() => ingest.mutate()}>Save</Button>
          </div>
        </div>
      )}
      {kpis.length === 0 ? <Empty icon={TrendingUp} title="No KPI history" /> : (
        <div className="rounded-2xl border border-border overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Period</th>
                <th className="text-right p-3">On-time</th>
                <th className="text-right p-3">Invoice</th>
                <th className="text-right p-3">Quality</th>
                <th className="text-right p-3">Responsiveness</th>
                <th className="text-right p-3">Composite</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map(k => (
                <tr key={k.id} className="border-t border-border">
                  <td className="p-3 font-mono">{k.period}</td>
                  <td className="p-3 text-right tabular-nums">{k.onTimeDeliveryPct ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums">{k.invoiceAccuracyPct ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums">{k.qualityPct ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums">{k.responsivenessPct ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{k.compositeScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RiskPanel({ vendorId, events, vendorName }: { vendorId: number; events: VendorBundle["riskEvents"]; vendorName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ source: "internal", severity: "amber", summary: "", link: "" });
  const raise = useMutation({
    mutationFn: () => api.post(`/api/vendors/${vendorId}/risk-events`, draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", vendorId] }); setOpen(false); setDraft({ source: "internal", severity: "amber", summary: "", link: "" }); toast({ title: "Risk recorded" }); },
  });
  const resolve = useMutation({
    mutationFn: (eventId: number) => api.post(`/api/vendors/${vendorId}/risk-events/${eventId}/resolve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor", vendorId] }); toast({ title: "Risk resolved" }); },
  });
  const aiSummarise = useMutation({
    mutationFn: () => api.post<{ summary: string; recommendedRiskStatus: string; drivers: string[] }>(`/api/ai/vendors/risk-summary`, { vendorName, riskEvents: events, segment: undefined }),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={aiSummarise.isPending} onClick={() => aiSummarise.mutate()}>
          <Sparkles size={12} className="mr-1.5" /> AI summary
        </Button>
        <Button size="sm" onClick={() => setOpen(o => !o)}>{open ? "Cancel" : "+ Raise risk"}</Button>
      </div>
      {aiSummarise.data && (
        <div className="rounded-2xl border border-border bg-card/40 p-4 text-sm space-y-2">
          <p>{aiSummarise.data.summary}</p>
          <p className="text-xs"><span className="text-muted-foreground">Recommended status:</span> <Badge>{aiSummarise.data.recommendedRiskStatus}</Badge></p>
          {aiSummarise.data.drivers?.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc list-inside">
              {aiSummarise.data.drivers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      )}
      {open && (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Source</Label>
            <select value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
              {["internal", "legal", "esg", "financial", "sanctions", "news", "other"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Severity</Label>
            <select value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="green">green</option>
              <option value="amber">amber</option>
              <option value="red">red</option>
            </select>
          </div>
          <div className="col-span-2"><Field2 label="Summary *" v={draft.summary} onChange={v => setDraft({ ...draft, summary: v })} /></div>
          <div className="col-span-2"><Field2 label="Link (optional)" v={draft.link} onChange={v => setDraft({ ...draft, link: v })} /></div>
          <div className="col-span-2 flex justify-end">
            <Button disabled={!draft.summary || raise.isPending} onClick={() => raise.mutate()}>Save</Button>
          </div>
        </div>
      )}
      {events.length === 0 ? <Empty icon={ShieldAlert} title="No risk events" /> : (
        <div className="space-y-2">
          {events.map(e => (
            <div key={e.id} className="rounded-xl border border-border bg-card/40 p-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className={RISK_TONE[e.severity] ?? ""}>{e.severity}</Badge>
                  <span className="text-xs uppercase text-muted-foreground">{e.source}</span>
                  <span className="text-xs text-muted-foreground">• {new Date(e.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm mt-1">{e.summary}</p>
              </div>
              {e.resolvedAt
                ? <Badge variant="outline">resolved</Badge>
                : <Button size="sm" variant="outline" onClick={() => resolve.mutate(e.id)}>Resolve</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field2({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={v} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function NumField({ label, v, onChange }: { label: string; v: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="number" min={0} max={100} value={v} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function Empty({ icon: Icon, title }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <Icon size={24} className="mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">{title}</p>
    </div>
  );
}
