import React from "react";
import { 
  BarChart, Activity, AlertCircle, CheckCircle2, ChevronDown, Clock, 
  Command, CreditCard, FileText, LayoutDashboard, Search, Settings, 
  ShieldAlert, SlidersHorizontal, Users, Zap, Bell, FolderKanban, 
  Briefcase, CheckSquare, Plus, MoveRight
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./styles.css";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";

const dataPortfolioHealth = [
  { name: "W1", risk: 12, budget: 85, progress: 40 },
  { name: "W2", risk: 15, budget: 82, progress: 45 },
  { name: "W3", risk: 10, budget: 86, progress: 55 },
  { name: "W4", risk: 8, budget: 88, progress: 65 },
  { name: "W5", risk: 5, budget: 90, progress: 78 },
  { name: "W6", risk: 4, budget: 92, progress: 85 },
];

export default function CommandCenterDashboard() {
  return (
    <div className="command-center-theme min-h-screen flex w-full overflow-hidden text-sm selection:bg-primary/30 antialiased">
      
      {/* Sidebar - Collapsible on small screens */}
      <aside className="w-16 lg:w-64 border-r bg-card flex-shrink-0 flex flex-col transition-all duration-300">
        <div className="h-14 border-b flex items-center px-4 justify-between group cursor-pointer hover:bg-secondary/50 transition-colors">
          <div className="flex items-center gap-3">
            <div className="size-6 rounded bg-primary text-primary-foreground flex items-center justify-center font-bold">
              <Command className="size-4" />
            </div>
            <span className="font-semibold tracking-tight hidden lg:block truncate text-foreground">Project Hub</span>
          </div>
          <ChevronDown className="size-4 text-muted-foreground hidden lg:block opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        
        <div className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto overflow-x-hidden px-2">
          <NavItem icon={<LayoutDashboard />} label="Dashboards" active />
          <NavItem icon={<Briefcase />} label="Portfolios" />
          <NavItem icon={<FolderKanban />} label="Projects" />
          <NavItem icon={<Users />} label="Resources" />
          <NavItem icon={<CheckSquare />} label="Approvals" badge="5" />
          <NavItem icon={<FileText />} label="Documents" />
          <NavItem icon={<Activity />} label="Reports" />
          
          <div className="mt-auto pt-4 border-t border-border/50">
            <NavItem icon={<Settings />} label="Admin" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative z-0">
        {/* Top Header */}
        <header className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center px-4 lg:px-8 gap-4 sticky top-0 z-10">
          <div className="flex items-center gap-2 max-w-sm flex-1">
            <Search className="size-4 text-muted-foreground" />
            <Input 
              type="text" 
              placeholder="Search projects, tasks, resources... (Ctrl+K)" 
              className="h-8 bg-transparent border-0 shadow-none focus-visible:ring-0 px-2 font-mono text-xs placeholder:text-muted-foreground/70"
            />
          </div>
          
          <div className="flex items-center gap-3 ml-auto">
            <Button variant="outline" size="sm" className="h-8 text-xs font-mono border-dashed rounded-[4px] gap-2 hidden sm:flex">
              <Plus className="size-3" /> New Project
            </Button>
            <div className="w-px h-4 bg-border mx-1"></div>
            <Button variant="ghost" size="icon" className="size-8 relative text-muted-foreground hover:text-foreground">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-1.5 bg-primary rounded-full ring-2 ring-background"></span>
            </Button>
            <Avatar className="size-8 border cursor-pointer hover:ring-1 hover:ring-primary transition-all">
              <AvatarImage src="https://api.dicebear.com/7.x/avataaars/svg?seed=Priya" />
              <AvatarFallback className="bg-secondary text-xs">PR</AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Scrollable Dashboard Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-[1600px] mx-auto space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Command Center</h1>
                <p className="text-muted-foreground mt-1 flex items-center gap-2">
                  <span className="inline-flex size-2 rounded-full bg-green-500 ring-2 ring-green-500/20"></span>
                  System nominal. Last sync: Just now
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" className="h-8 rounded-[4px]">
                  <SlidersHorizontal className="size-3 mr-2" />
                  Customize
                </Button>
                <Button size="sm" className="h-8 rounded-[4px] bg-primary text-primary-foreground hover:bg-primary/90">
                  Generate Report
                </Button>
              </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard 
                title="Active Projects" 
                value="12" 
                trend="+2 this month" 
                icon={<FolderKanban className="size-4 text-primary" />} 
              />
              <KpiCard 
                title="Due This Week" 
                value="8" 
                trend="3 critical path" 
                trendColor="text-amber-400"
                icon={<Clock className="size-4 text-amber-400" />} 
              />
              <KpiCard 
                title="Overdue Tasks" 
                value="3" 
                trend="Action required" 
                trendColor="text-red-400"
                icon={<AlertCircle className="size-4 text-red-400" />} 
                highlight
              />
              <KpiCard 
                title="Pending Approvals" 
                value="5" 
                trend="2 overdue" 
                icon={<CheckSquare className="size-4 text-primary" />} 
              />
            </div>

            {/* Middle Section: Chart & Tasks */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Chart */}
              <Card className="lg:col-span-2 cc-mono-card border-border/50 rounded-lg shadow-none flex flex-col">
                <CardHeader className="pb-2 border-b border-border/40">
                  <CardTitle className="text-sm font-medium flex justify-between items-center">
                    Portfolio Health vs Budget
                    <Badge variant="outline" className="font-mono text-[10px] rounded-[4px]">H1 FY24</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 flex-1 min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dataPortfolioHealth} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorProgress" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '4px', fontSize: '12px' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Area type="monotone" dataKey="progress" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorProgress)" />
                      <Area type="monotone" dataKey="budget" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4 4" fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Due This Week / Overdue */}
              <div className="space-y-6 flex flex-col">
                <Card className="cc-mono-card border-border/50 rounded-lg shadow-none flex-1">
                  <CardHeader className="pb-2 border-b border-border/40">
                    <CardTitle className="text-sm font-medium flex justify-between">
                      Critical Tasks
                      <span className="text-muted-foreground font-mono text-[10px]">T-7 DAYS</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border/40">
                      <TaskRow name="UAT Sign-off" project="Atlas ERP" due="Today" priority="P1" status="overdue" />
                      <TaskRow name="Vendor Contract Review" project="Helios APAC" due="Tomorrow" priority="P1" />
                      <TaskRow name="Data Migration Dry Run" project="Northwind" due="Wed" priority="P2" />
                      <TaskRow name="Security Audit" project="Atlas ERP" due="Thu" priority="P2" />
                      <TaskRow name="Board Presentation Prep" project="Project Hub" due="Fri" priority="P3" />
                    </div>
                  </CardContent>
                  <CardFooter className="p-2 border-t border-border/40 bg-secondary/20">
                    <Button variant="ghost" className="w-full h-7 text-xs justify-between group">
                      View all 15 tasks
                      <MoveRight className="size-3 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </CardFooter>
                </Card>
              </div>

            </div>

            {/* My Projects Grid */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider">Monitored Initiatives</h2>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-sm font-mono text-[10px]">Filter: P1 only</Badge>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <ProjectCard 
                  name="Atlas — ERP Cloud Migration"
                  rag="red"
                  progress={62}
                  baseline={68}
                  variance="-14d"
                  issues={8}
                  budget="$4.2M"
                />
                <ProjectCard 
                  name="Helios — APAC Distribution Center"
                  rag="amber"
                  progress={45}
                  baseline={42}
                  variance="+4d"
                  issues={3}
                  budget="$12.5M"
                />
                <ProjectCard 
                  name="Northwind — Data Platform Re-Platform"
                  rag="green"
                  progress={88}
                  baseline={85}
                  variance="+2d"
                  issues={1}
                  budget="$2.1M"
                />
                <ProjectCard 
                  name="Titan — Q3 Enterprise Security Rollout"
                  rag="green"
                  progress={35}
                  baseline={35}
                  variance="0d"
                  issues={0}
                  budget="$850K"
                />
                <ProjectCard 
                  name="Zephyr — CRM Unification"
                  rag="amber"
                  progress={15}
                  baseline={20}
                  variance="-5d"
                  issues={4}
                  budget="$1.8M"
                />
                <ProjectCard 
                  name="Project Hub — Internal PMO Launch"
                  rag="green"
                  progress={95}
                  baseline={90}
                  variance="+5d"
                  issues={2}
                  budget="$300K"
                />
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

// Sub-components

function NavItem({ icon, label, active, badge }: { icon: React.ReactNode, label: string, active?: boolean, badge?: string }) {
  return (
    <button className={`
      flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors w-full group
      ${active ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}
    `}>
      <div className={`size-4 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>
        {icon}
      </div>
      <span className="hidden lg:block truncate">{label}</span>
      {badge && (
        <span className="hidden lg:flex ml-auto bg-primary text-primary-foreground text-[10px] font-bold h-4 px-1.5 items-center rounded-sm">
          {badge}
        </span>
      )}
    </button>
  );
}

function KpiCard({ title, value, trend, icon, highlight, trendColor = "text-muted-foreground" }: any) {
  return (
    <Card className={`rounded-lg border-border/50 shadow-none overflow-hidden relative ${highlight ? 'ring-1 ring-red-500/50 bg-red-500/5' : 'bg-card'}`}>
      {highlight && <div className="absolute top-0 left-0 w-full h-0.5 bg-red-500"></div>}
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-start mb-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <div className="p-1.5 rounded-md bg-secondary/50">{icon}</div>
        </div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-mono font-semibold tracking-tight">{value}</h3>
        </div>
        <p className={`text-[10px] font-mono mt-1 ${trendColor}`}>{trend}</p>
      </CardContent>
    </Card>
  );
}

function TaskRow({ name, project, due, priority, status }: any) {
  const isOverdue = status === 'overdue';
  return (
    <div className="px-4 py-3 hover:bg-secondary/30 transition-colors flex items-center justify-between group cursor-pointer">
      <div className="flex items-start gap-3 overflow-hidden">
        <div className={`mt-0.5 size-3.5 rounded-[3px] border flex-shrink-0 ${isOverdue ? 'border-red-500/50 bg-red-500/10' : 'border-border'}`}></div>
        <div className="min-w-0">
          <p className={`text-xs font-medium truncate ${isOverdue ? 'text-red-400' : 'text-foreground'}`}>{name}</p>
          <p className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">{project}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 pl-2">
        {isOverdue ? (
          <Badge variant="outline" className="text-[9px] h-4 px-1 border-red-500/30 text-red-400 bg-red-500/10 uppercase tracking-wider rounded-[2px]">Overdue</Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground font-mono">{due}</span>
        )}
        <span className={`text-[10px] font-mono font-bold w-4 text-center ${priority === 'P1' ? 'text-primary' : 'text-muted-foreground'}`}>{priority}</span>
      </div>
    </div>
  );
}

function ProjectCard({ name, rag, progress, baseline, variance, issues, budget }: any) {
  const ragColors: Record<string, string> = {
    green: "cc-bg-green cc-rag-green ring-green-500/30",
    amber: "cc-bg-amber cc-rag-amber ring-amber-500/30",
    red: "cc-bg-red cc-rag-red ring-red-500/30",
  };
  
  const vNum = parseInt(variance.replace('d',''));
  const vColor = vNum < 0 ? "text-red-400" : (vNum > 0 ? "text-green-400" : "text-muted-foreground");

  return (
    <Card className="cc-mono-card border-border/50 rounded-lg shadow-none hover:border-border transition-colors cursor-pointer group">
      <CardHeader className="p-4 pb-0 flex flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-2 max-w-[85%]">
          <div className={`size-2.5 rounded-full ring-2 ring-offset-2 ring-offset-background shrink-0 ${
            rag === 'green' ? 'bg-green-500 ring-green-500/20' : 
            rag === 'amber' ? 'bg-amber-500 ring-amber-500/20' : 
            'bg-red-500 ring-red-500/20'
          }`}></div>
          <CardTitle className="text-sm font-medium truncate group-hover:text-primary transition-colors">{name}</CardTitle>
        </div>
        <Button variant="ghost" size="icon" className="size-6 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <MoveRight className="size-3" />
        </Button>
      </CardHeader>
      
      <CardContent className="p-4 pt-3">
        <div className="space-y-4">
          
          {/* Dual Track Progress */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-muted-foreground">ACTUAL VS BASELINE</span>
              <span>{progress}% / {baseline}%</span>
            </div>
            <div className="relative h-1.5 bg-secondary rounded-full overflow-hidden">
              {/* Baseline marker (gray) */}
              <div className="absolute top-0 left-0 h-full bg-muted-foreground/40" style={{ width: `${baseline}%` }}></div>
              {/* Actual progress (primary) */}
              <div className="absolute top-0 left-0 h-full bg-primary" style={{ width: `${progress}%` }}></div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40">
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">Variance</span>
              <span className={`text-xs font-mono font-medium ${vColor}`}>{variance}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">Open Iss.</span>
              <span className="text-xs font-mono font-medium text-foreground">{issues}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-mono">Budget</span>
              <span className="text-xs font-mono font-medium text-foreground">{budget}</span>
            </div>
          </div>

        </div>
      </CardContent>
    </Card>
  );
}
