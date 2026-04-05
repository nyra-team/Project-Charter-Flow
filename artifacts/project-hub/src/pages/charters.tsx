import { useListCharters } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ChartersList() {
  const { data: charters, isLoading } = useListCharters();
  const [search, setSearch] = useState("");

  const filteredCharters = charters?.filter((c) => 
    c.title.toLowerCase().includes(search.toLowerCase()) || 
    c.status.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Project Charters</h2>
        <Link href="/charters/new">
          <Button>New Charter</Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search charters..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredCharters && filteredCharters.length > 0 ? (
            <div className="rounded-md border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Budget</th>
                    <th className="px-4 py-3 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCharters.map((charter) => (
                    <tr key={charter.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/charters/${charter.id}`} className="hover:underline text-primary">
                          {charter.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={charter.status} />
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(charter.tentativeBudget)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatDate(charter.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No charters found matching "{search}"
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
