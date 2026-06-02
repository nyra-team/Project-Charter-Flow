import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Badge } from "@/components/ui/badge";

type VendorMaster = {
  id: number;
  name: string;
  segment: string;
  riskStatus: string;
  category: string | null;
};

type VendorBundle = {
  vendor: VendorMaster;
  kpis: Array<{ period: string; compositeScore: number | null }>;
};

const SEGMENT_TONE: Record<string, string> = {
  strategic: "bg-violet-500/15 text-violet-700",
  preferred: "bg-emerald-500/15 text-emerald-700",
  approved: "bg-blue-500/15 text-blue-700",
  provisional: "bg-amber-500/15 text-amber-700",
  blocked: "bg-rose-500/15 text-rose-700",
};

export default function VendorScorecardsPage() {
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => api.get<VendorMaster[]>("/api/vendors"),
  });

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vendor Scorecards</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Cross-vendor performance. Click a row for full KPI history and risk feed.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {vendors.map(v => <ScorecardCard key={v.id} vendor={v} />)}
        {vendors.length === 0 && <p className="text-sm text-muted-foreground">No vendors yet.</p>}
      </div>
    </div>
  );
}

function ScorecardCard({ vendor }: { vendor: VendorMaster }) {
  const { data } = useQuery({
    queryKey: ["vendor", vendor.id, "scorecard"],
    queryFn: () => api.get<VendorBundle>(`/api/vendors/${vendor.id}`),
  });
  const latest = data?.kpis?.[0];
  return (
    <Link href={`/vendors/${vendor.id}`}>
      <div className="rounded-2xl border border-border bg-card/40 p-4 hover:border-primary/40 cursor-pointer transition-colors">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold truncate">{vendor.name}</p>
          <Badge className={SEGMENT_TONE[vendor.segment] ?? ""}>{vendor.segment}</Badge>
        </div>
        {vendor.category && <p className="text-xs text-muted-foreground mt-0.5">{vendor.category}</p>}
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl font-black tabular-nums">{latest?.compositeScore ?? "—"}</span>
          {latest && <span className="text-xs text-muted-foreground font-mono">{latest.period}</span>}
        </div>
      </div>
    </Link>
  );
}
