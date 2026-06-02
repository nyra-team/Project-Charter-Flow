import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

type VendorBody = {
  name: string;
  legalName?: string;
  gst?: string;
  pan?: string;
  country?: string;
  region?: string;
  category?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  sapVendorCode?: string;
  segment?: string;
};

export default function VendorNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<VendorBody>({ name: "", country: "IN", segment: "provisional" });

  const create = useMutation({
    mutationFn: (body: VendorBody) => api.post<{ id: number }>("/api/vendors", body),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast({ title: "Vendor registered" });
      navigate(`/vendors/${row.id}`);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  function set<K extends keyof VendorBody>(k: K, v: VendorBody[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  const valid = form.name.trim().length >= 2;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate("/vendors")} className="text-muted-foreground">
        <ArrowLeft size={14} className="mr-1" /> Back to vendors
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register vendor</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manual entry by PMO/SCM. Vendors entered here can be qualified immediately; they don't get portal access until you invite them to an RFx.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor name *" v={form.name} onChange={v => set("name", v)} placeholder="Acme Pvt Ltd" />
          <Field label="Legal name" v={form.legalName ?? ""} onChange={v => set("legalName", v)} placeholder="Acme Private Limited" />
          <Field label="GST" v={form.gst ?? ""} onChange={v => set("gst", v)} placeholder="29ABCDE1234F1Z5" />
          <Field label="PAN" v={form.pan ?? ""} onChange={v => set("pan", v)} placeholder="ABCDE1234F" />
          <Field label="Country" v={form.country ?? ""} onChange={v => set("country", v)} placeholder="IN" />
          <Field label="Region / state" v={form.region ?? ""} onChange={v => set("region", v)} placeholder="Telangana" />
          <Field label="Category" v={form.category ?? ""} onChange={v => set("category", v)} placeholder="API supplier" />
          <Field label="SAP vendor code" v={form.sapVendorCode ?? ""} onChange={v => set("sapVendorCode", v)} placeholder="V100245" />
          <Field label="Email" v={form.email ?? ""} onChange={v => set("email", v)} placeholder="contact@acme.com" />
          <Field label="Phone" v={form.phone ?? ""} onChange={v => set("phone", v)} placeholder="+91…" />
          <Field label="Website" v={form.website ?? ""} onChange={v => set("website", v)} placeholder="acme.com" />
          <div className="space-y-1">
            <Label>Segment</Label>
            <select
              value={form.segment ?? "provisional"}
              onChange={e => set("segment", e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="provisional">Provisional</option>
              <option value="approved">Approved</option>
              <option value="preferred">Preferred</option>
              <option value="strategic">Strategic</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
        </div>
        <div className="col-span-2">
          <Label>Address</Label>
          <Input value={form.address ?? ""} onChange={e => set("address", e.target.value)} placeholder="Full registered address" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={() => navigate("/vendors")}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate(form)}>
            {create.isPending ? "Registering…" : "Register"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, onChange, placeholder }: { label: string; v: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={v} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
