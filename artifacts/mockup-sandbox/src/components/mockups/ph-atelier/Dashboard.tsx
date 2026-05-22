import React from "react";
import { 
  BarChart, 
  LayoutDashboard, 
  FolderKanban, 
  CheckSquare, 
  Users, 
  FileText, 
  Settings,
  Bell,
  Search,
  ChevronDown,
  MoreHorizontal,
  Clock,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Activity,
  ArrowRight
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import "./styles.css";

const MOCK_DATA = {
  kpis: [
    { label: "Active Projects", value: "12", icon: FolderKanban, trend: "+2 this quarter", color: "text-blue-400" },
    { label: "Due This Week", value: "8", icon: CheckSquare, trend: "3 high priority", color: "text-amber-400" },
    { label: "Overdue Tasks", value: "3", icon: AlertCircle, trend: "Requires attention", color: "text-red-400" },
    { label: "Pending Approvals", value: "5", icon: Clock, trend: "2 blockages", color: "text-purple-400" }
  ],
  tasksDue: [
    { id: 1, name: "Finalize Q3 Budget Allocation", project: "Atlas — ERP Migration", dueDate: "Tomorrow", priority: "P1", status: "In Progress" },
    { id: 2, name: "Vendor Security Assessment", project: "Helios — APAC Dist", dueDate: "Wed", priority: "P2", status: "Not Started" },
    { id: 3, name: "Data Warehouse Schema Review", project: "Northwind — Data Plat", dueDate: "Thu", priority: "P1", status: "In Progress" },
    { id: 4, name: "UAT Sign-off Signatures", project: "Atlas — ERP Migration", dueDate: "Fri", priority: "P1", status: "Not Started" },
    { id: 5, name: "Submit Change Request #42", project: "Nova — Retail POS", dueDate: "Fri", priority: "P3", status: "Completed" },
    { id: 6, name: "Weekly SteerCo Deck", project: "All Projects", dueDate: "Fri", priority: "P2", status: "In Progress" },
  ],
  overdueTasks: [
    { id: 7, name: "Legal Counsel Review", project: "Helios — APAC Dist", days: 4, priority: "P1" },
    { id: 8, name: "API Gateway Provisioning", project: "Northwind — Data Plat", days: 2, priority: "P2" },
    { id: 9, name: "Stakeholder Alignment", project: "Nova — Retail POS", days: 1, priority: "P2" },
  ],
  projects: [
    { name: "Atlas — ERP Cloud Migration", rag: "Amber", progress: 68, variance: -4, issues: 3, crs: 1, budget: "$4.2M" },
    { name: "Helios — APAC Distribution", rag: "Green", progress: 42, variance: +2, issues: 0, crs: 0, budget: "$12.5M" },
    { name: "Northwind — Data Platform", rag: "Red", progress: 85, variance: -14, issues: 8, crs: 4, budget: "$2.1M" },
    { name: "Nova — Retail POS Rollout", rag: "Green", progress: 15, variance: 0, issues: 1, crs: 0, budget: "$8.9M" },
    { name: "Quantum — Supply Chain AI", rag: "Green", progress: 92, variance: +5, issues: 2, crs: 1, budget: "$5.4M" },
    { name: "Zenith — HRIS Replacement", rag: "Amber", progress: 34, variance: -2, issues: 5, crs: 2, budget: "$3.8M" },
  ],
  chartData: [
    { name: "Week 1", effort: 400, baseline: 420 },
    { name: "Week 2", effort: 300, baseline: 380 },
    { name: "Week 3", effort: 550, baseline: 450 },
    { name: "Week 4", effort: 480, baseline: 480 },
    { name: "Week 5", effort: 600, baseline: 520 },
    { name: "Week 6", effort: 750, baseline: 600 },
    { name: "Week 7", effort: 820, baseline: 650 },
  ]
};

const PriorityBadge = ({ level }: { level: string }) => {
  const colors: Record<string, string> = {
    P1: "bg-red-500/10 text-red-400 border-red-500/20",
    P2: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    P3: "bg-blue-500/10 text-blue-400 border-blue-500/20"
  };
  return (
    <Badge variant="outline" className={cn("px-2 py-0.5 text-[10px] font-medium tracking-wider", colors[level] || "")}>
      {level}
    </Badge>
  );
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "Completed") return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === "In Progress") return <Activity className="w-4 h-4 text-blue-400" />;
  return <div className="w-4 h-4 rounded-full border border-dashed border-muted-foreground/50" />;
};

const RagIndicator = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    Red: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]",
    Amber: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]",
    Green: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
  };
  return <div className={cn("w-2 h-2 rounded-full", colors[status])} />;
};

export default function AtelierDashboard() {
  return (
    <div className="atelier-theme min-h-screen relative text-sm overflow-x-hidden">
      <div className="atelier-mesh-bg" />
      
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-white/5 bg-background/40 backdrop-blur-xl z-20 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center mr-3 shadow-lg">
            <span className="text-white font-bold text-lg tracking-tighter">P</span>
          </div>
          <span className="font-semibold text-lg tracking-tight text-white/90">Project Hub</span>
        </div>
        
        <div className="px-4 py-6 space-y-8 flex-1 overflow-y-auto">
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-3 px-2 tracking-wider uppercase">Workspace</div>
            <nav className="space-y-1">
              {[
                { icon: LayoutDashboard, label: "Dashboard", active: true },
                { icon: FolderKanban, label: "Portfolios" },
                { icon: CheckSquare, label: "Projects" },
                { icon: Users, label: "Resources" },
              ].map((item, i) => (
                <button key={i} className={cn(
                  "w-full flex items-center px-3 py-2 rounded-lg transition-all duration-200 group",
                  item.active ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}>
                  <item.icon className={cn("w-4 h-4 mr-3", item.active ? "text-amber-400" : "group-hover:text-amber-400/70 transition-colors")} />
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
          
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-3 px-2 tracking-wider uppercase">Governance</div>
            <nav className="space-y-1">
              {[
                { icon: Clock, label: "Approvals", badge: 5 },
                { icon: FileText, label: "Documents" },
                { icon: BarChart, label: "Reports" },
                { icon: Settings, label: "Admin" },
              ].map((item, i) => (
                <button key={i} className="w-full flex items-center px-3 py-2 rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white transition-all duration-200 group">
                  <item.icon className="w-4 h-4 mr-3 group-hover:text-purple-400/70 transition-colors" />
                  <span className="font-medium flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span className="bg-purple-500/20 text-purple-300 py-0.5 px-2 rounded-full text-xs font-medium">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>
        
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
            <Avatar className="w-9 h-9 border border-white/10">
              <AvatarImage src="https://i.pravatar.cc/150?u=priya" />
              <AvatarFallback className="bg-secondary">PR</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">Priya Raman</div>
              <div className="text-xs text-muted-foreground truncate">PMO Director</div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:pl-64 flex-1 flex flex-col min-h-screen relative z-10">
        {/* Topbar */}
        <header className="h-16 border-b border-white/5 bg-background/40 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Search projects, tasks, or resources..." 
                className="w-full bg-white/5 border-white/10 pl-9 pr-4 h-9 text-sm focus-visible:ring-amber-500/50 rounded-full transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-muted-foreground hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-background"></span>
            </button>
            <Button className="bg-white/10 hover:bg-white/20 text-white border-white/10 h-9 rounded-full px-5 font-medium transition-all shadow-[0_0_15px_rgba(255,255,255,0.05)]">
              New Project
            </Button>
          </div>
        </header>

        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8 animate-fade-in-up">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-white mb-1">
                Good morning, Priya.
              </h1>
              <p className="text-muted-foreground text-base">Here's the pulse of your portfolios today.</p>
            </div>
            <div className="flex items-center gap-3">
              <select className="bg-transparent border border-white/10 text-sm rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-amber-500/50">
                <option>All Portfolios</option>
                <option>Transformation</option>
                <option>IT Infrastructure</option>
              </select>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MOCK_DATA.kpis.map((kpi, i) => (
              <div 
                key={i} 
                className="atelier-glass rounded-2xl p-5 group hover:-translate-y-1 transition-all duration-300"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={cn("p-2 rounded-xl bg-white/5", kpi.color)}>
                    <kpi.icon className="w-5 h-5" />
                  </div>
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-3xl font-semibold text-white mb-1 tracking-tight">{kpi.value}</div>
                <div className="text-sm font-medium text-muted-foreground mb-1">{kpi.label}</div>
                <div className="text-xs text-muted-foreground/70">{kpi.trend}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Viz */}
            <div className="lg:col-span-2 space-y-6">
              <div className="atelier-glass rounded-2xl p-6 h-[400px] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Portfolio Effort Burn</h3>
                    <p className="text-sm text-muted-foreground">Actual vs Baseline across all active projects</p>
                  </div>
                  <div className="flex gap-4 text-xs font-medium">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-amber-400/80"></div>Actual</div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-white/20"></div>Baseline</div>
                  </div>
                </div>
                <div className="flex-1 min-h-0 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={MOCK_DATA.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorEffort" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="rgb(251, 191, 36)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="rgb(251, 191, 36)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: 'rgba(20,20,25,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area type="monotone" dataKey="effort" stroke="rgb(251, 191, 36)" strokeWidth={2} fillOpacity={1} fill="url(#colorEffort)" />
                      <Line type="monotone" dataKey="baseline" stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* My Projects */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">My Projects</h3>
                  <Button variant="link" className="text-amber-400 hover:text-amber-300 h-auto p-0">View all <ArrowRight className="w-4 h-4 ml-1" /></Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MOCK_DATA.projects.map((proj, i) => (
                    <div key={i} className="atelier-glass rounded-xl p-5 hover:bg-white/[0.04] transition-colors cursor-pointer group">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <RagIndicator status={proj.rag} />
                          <h4 className="font-semibold text-white text-base truncate pr-2" title={proj.name}>{proj.name}</h4>
                        </div>
                        <span className="text-sm font-medium text-white/80">{proj.progress}%</span>
                      </div>
                      
                      <div className="w-full h-1.5 bg-black/40 rounded-full mb-4 overflow-hidden relative">
                        <div 
                          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-amber-500/50 to-amber-400" 
                          style={{ width: `${proj.progress}%` }}
                        />
                        <div 
                          className="absolute left-0 top-0 h-full rounded-full bg-white/20 block" 
                          style={{ width: `${proj.progress + (proj.variance > 0 ? proj.variance : 0)}%`, opacity: 0.5, zIndex: -1 }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/5 text-xs">
                        <div>
                          <div className="text-muted-foreground/70 mb-1">Variance</div>
                          <div className={cn("font-medium", proj.variance < 0 ? "text-red-400" : "text-emerald-400")}>
                            {proj.variance > 0 ? "+" : ""}{proj.variance}d
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground/70 mb-1">Issues / CRs</div>
                          <div className="font-medium text-white/90">{proj.issues} / {proj.crs}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground/70 mb-1">Budget</div>
                          <div className="font-medium text-white/90">{proj.budget}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Tasks & Actionables */}
            <div className="space-y-6">
              {/* Overdue */}
              <div className="atelier-glass rounded-2xl overflow-hidden border-red-500/20">
                <div className="bg-red-500/10 p-4 border-b border-red-500/10 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <h3 className="font-semibold text-red-400">Requires Attention</h3>
                </div>
                <div className="p-2">
                  {MOCK_DATA.overdueTasks.map((task, i) => (
                    <div key={i} className="p-3 hover:bg-white/5 rounded-lg transition-colors flex items-start gap-3 group">
                      <div className="mt-0.5"><div className="w-4 h-4 rounded-sm border border-red-500/30 bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white/90 text-sm truncate">{task.name}</div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{task.project}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-transparent px-1.5 py-0 text-[10px] uppercase">
                            {task.days}d overdue
                          </Badge>
                          <PriorityBadge level={task.priority} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tasks Due */}
              <div className="atelier-glass rounded-2xl p-5">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-semibold text-white">My Tasks</h3>
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="bg-white/10 text-white hover:bg-white/20 cursor-pointer">Due Soon</Badge>
                  </div>
                </div>
                
                <div className="space-y-1">
                  {MOCK_DATA.tasksDue.map((task, i) => (
                    <div key={i} className="p-3 hover:bg-white/5 rounded-xl transition-colors flex items-center gap-3 group">
                      <StatusIcon status={task.status} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white/90 text-sm truncate">{task.name}</div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{task.project}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="text-xs text-white/70">{task.dueDate}</div>
                        <PriorityBadge level={task.priority} />
                      </div>
                    </div>
                  ))}
                </div>
                
                <Button variant="ghost" className="w-full mt-4 text-muted-foreground hover:text-white border border-white/5 hover:bg-white/5">
                  View All Tasks
                </Button>
              </div>

              {/* Approvals Callout */}
              <div className="atelier-glass rounded-2xl p-5 bg-gradient-to-br from-purple-900/20 to-transparent border-purple-500/20 relative overflow-hidden group">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-purple-500/20 rounded-full blur-2xl group-hover:bg-purple-500/30 transition-colors" />
                <div className="flex items-start gap-4 relative z-10">
                  <div className="p-3 bg-purple-500/20 rounded-xl">
                    <CheckSquare className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-base mb-1">5 Pending Approvals</h3>
                    <p className="text-sm text-muted-foreground mb-4">2 stage-gate approvals are blocking progress.</p>
                    <Button size="sm" className="bg-purple-500 hover:bg-purple-600 text-white border-0 shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                      Review Now
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
