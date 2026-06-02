import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, Search, Filter } from "lucide-react";

type VendorMaster = {
  id: number;
  name: string;
  legalName: string | null;
  category: string | null;
  region: string | null;
  segment: string;
  riskStatus: string;
  sapVendorCode: string | null;
  email: string | null;
  updatedAt: string;
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

export default function VendorsPage() {
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<string>("");
  const [risk, setRisk] = useState<string>("");

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", q, segment, risk],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (segment) params.set("segment", segment);
      if (risk) params.set("risk", risk);
      return api.get<VendorMaster[]>(`/api/vendors${params.size ? `?${params}` : ""}`);
    },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendor Master</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Source of truth for every supplier. Registrations flow in from the vendor portal; PMO qualifies, segments, and scorecards them here.
          </p>
        </div>
        <Link href="/vendors/new">
          <Button>
            <Plus size={14} className="mr-1.5" />
            Register vendor
          </Button>
        </Link>
      </div>

      {/* Filter bar */}
      <div className="rounded-2xl border border-border bg-card/40 p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name / GST / SAP code / email"
            className="pl-8"
          />
        </div>
        <select
          value={segment}
          onChange={e => setSegment(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Segment filter"
        >
          <option value="">All segments</option>
          <option value="strategic">Strategic</option>
          <option value="preferred">Preferred</option>
          <option value="approved">Approved</option>
          <option value="provisional">Provisional</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          value={risk}
          onChange={e => setRisk(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Risk filter"
        >
          <option value="">All risk</option>
          <option value="green">Green</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
          <option value="unknown">Unknown</option>
        </select>
        <Link href="/vendors/scorecards" className="ml-auto">
          <Button variant="outline" size="sm">
            <Filter size={12} className="mr-1.5" />
            Scorecards
          </Button>
        </Link>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>
      ) : vendors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Building2 size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold">No vendors match the current filters</p>
          <p className="text-sm text-muted-foreground mt-1">
            Vendors register themselves on the portal; you can also enter one manually.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3">Category</th>
                <th className="text-left p-3">Region</th>
                <th className="text-left p-3">SAP code</th>
                <th className="text-left p-3">Segment</th>
                <th className="text-left p-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.id} className="border-t border-border hover:bg-card/40">
                  <td className="p-3">
                    <Link href={`/vendors/${v.id}`}>
                      <span className="font-semibold hover:underline cursor-pointer">{v.name}</span>
                    </Link>
                    {v.legalName ? <div className="text-xs text-muted-foreground">{v.legalName}</div> : null}
                  </td>
                  <td className="p-3 text-muted-foreground">{v.category || "—"}</td>
                  <td className="p-3 text-muted-foreground">{v.region || "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{v.sapVendorCode || "—"}</td>
                  <td className="p-3">
                    <Badge className={SEGMENT_TONE[v.segment] ?? ""}>{v.segment}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge className={RISK_TONE[v.riskStatus] ?? ""}>{v.riskStatus}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
