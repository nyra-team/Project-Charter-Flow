import React, { useState } from "react";
import { 
  Bell, 
  Search, 
  ChevronDown, 
  LayoutDashboard, 
  Briefcase, 
  FolderKanban, 
  Users, 
  CheckSquare, 
  FileText, 
  BarChart2, 
  Settings,
  Menu,
  X,
  AlertCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  MoreHorizontal
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";

// Data
const portfolioHealthData = [
  { name: "Jan", value: 85 },
  { name: "Feb", value: 88 },
  { name: "Mar", value: 86 },
  { name: "Apr", value: 92 },
  { name: "May", value: 90 },
  { name: "Jun", value: 94 },
];

const projects = [
  {
    id: 1,
    name: "Atlas — ERP Cloud Migration",
    rag: "amber",
    progress: 68,
    baseline: 75,
    variance: -14,
    issues: 3,
    crs: 1,
    budget: "$4.2M",
  },
  {
    id: 2,
    name: "Helios — APAC Distribution Center",
    rag: "green",
    progress: 42,
    baseline: 40,
    variance: 5,
    issues: 0,
    crs: 0,
    budget: "$12.5M",
  },
  {
    id: 3,
    name: "Northwind — Data Platform Re-Platform",
    rag: "green",
    progress: 89,
    baseline: 89,
    variance: 0,
    issues: 1,
    crs: 2,
    budget: "$2.8M",
  },
  {
    id: 4,
    name: "Vanguard — Security Operations Center",
    rag: "red",
    progress: 24,
    baseline: 45,
    variance: -32,
    issues: 8,
    crs: 4,
    budget: "$6.1M",
  },
  {
    id: 5,
    name: "Odyssey — Customer Portal V2",
    rag: "green",
    progress: 15,
    baseline: 12,
    variance: 4,
    issues: 0,
    crs: 0,
    budget: "$1.4M",
  },
  {
    id: 6,
    name: "Zenith — Supply Chain AI",
    rag: "amber",
    progress: 55,
    baseline: 60,
    variance: -8,
    issues: 2,
    crs: 1,
    budget: "$3.9M",
  },
];

const tasksDue = [
  { id: 1, name: "Finalize vendor selection matrix", project: "Atlas — ERP Cloud Migration", due: "Today", priority: "P1" },
  { id: 2, name: "Review Q3 resource allocation", project: "Portfolio Ops", due: "Tomorrow", priority: "P2" },
  { id: 3, name: "Sign off on UAT test scripts", project: "Odyssey — Customer Portal V2", due: "Tomorrow", priority: "P1" },
  { id: 4, name: "Approve architecture baseline", project: "Northwind — Data Platform Re-Platform", due: "Thu", priority: "P2" },
  { id: 5, name: "Draft communications plan", project: "Helios — APAC Distribution Center", due: "Fri", priority: "P3" },
  { id: 6, name: "Submit budget variance report", project: "Vanguard — Security Operations Center", due: "Fri", priority: "P1" },
];

const overdueTasks = [
  { id: 1, name: "Submit revised project charter", project: "Vanguard — Security Operations Center", days: 4 },
  { id: 2, name: "Review compliance audit findings", project: "Atlas — ERP Cloud Migration", days: 2 },
  { id: 3, name: "Approve vendor SOW", project: "Zenith — Supply Chain AI", days: 1 },
];

export default function ExecutiveBriefDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap');
        
        .executive-theme {
          --bg-paper: #F9F8F6;
          --bg-surface: #FFFFFF;
          --text-primary: #1A1A1A;
          --text-secondary: #5A5A5A;
          --text-tertiary: #8C8C8C;
          --border-color: #E6E4DF;
          
          --brand-primary: #0F172A;
          
          --rag-green: #248253;
          --rag-amber: #D97706;
          --rag-red: #DC2626;
          
          --rag-green-bg: #ECFDF5;
          --rag-amber-bg: #FFFBEB;
          --rag-red-bg: #FEF2F2;

          background-color: var(--bg-paper);
          color: var(--text-primary);
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
        }

        .executive-theme .font-serif {
          font-family: 'Playfair Display', serif;
        }

        .executive-theme .card-shadow {
          box-shadow: 0 4px 20px -4px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02);
          border: 1px solid var(--border-color);
        }

        .executive-theme .text-balance {
          text-wrap: balance;
        }
      `}</style>

      <div className="executive-theme flex flex-col md:flex-row w-full overflow-hidden h-screen text-[#1A1A1A]">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-[#E6E4DF] sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#0F172A] rounded flex items-center justify-center text-white font-serif font-bold italic">
              P
            </div>
            <span className="font-serif font-medium text-lg">Project Hub</span>
          </div>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2">
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Sidebar */}
        <aside className={`
          fixed md:static inset-y-0 left-0 z-40
          w-64 bg-white border-r border-[#E6E4DF]
          transform transition-transform duration-300 ease-in-out
          flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <div className="p-6 hidden md:flex items-center gap-3">
            <div className="w-8 h-8 bg-[#0F172A] rounded flex items-center justify-center text-white font-serif font-bold italic">
              P
            </div>
            <span className="font-serif font-semibold text-xl tracking-tight">Project Hub</span>
          </div>

          <div className="px-6 py-4 flex-1 overflow-y-auto">
            <div className="mb-8">
              <div className="text-xs font-medium text-[#8C8C8C] uppercase tracking-wider mb-4">Organization</div>
              <button className="flex items-center justify-between w-full p-2 -mx-2 rounded hover:bg-[#F9F8F6] transition-colors">
                <span className="font-medium text-sm">Acme Corp Global</span>
                <ChevronDown size={14} className="text-[#8C8C8C]" />
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-[#8C8C8C] uppercase tracking-wider mb-4 mt-6">Navigation</div>
              {[
                { icon: LayoutDashboard, label: "Dashboards", active: true },
                { icon: Briefcase, label: "Portfolios" },
                { icon: FolderKanban, label: "Projects" },
                { icon: Users, label: "Resources" },
                { icon: CheckSquare, label: "Approvals", badge: 5 },
                { icon: FileText, label: "Documents" },
                { icon: BarChart2, label: "Reports" },
              ].map((item, i) => (
                <button 
                  key={i}
                  className={`flex items-center justify-between w-full p-2 -mx-2 rounded transition-colors ${
                    item.active 
                      ? "bg-[#F9F8F6] text-[#0F172A] font-medium" 
                      : "text-[#5A5A5A] hover:bg-[#F9F8F6] hover:text-[#0F172A]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon size={18} className={item.active ? "text-[#0F172A]" : "text-[#8C8C8C]"} />
                    <span className="text-sm">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="bg-[#0F172A] text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-1 mt-8">
              <div className="text-xs font-medium text-[#8C8C8C] uppercase tracking-wider mb-4">System</div>
              <button className="flex items-center gap-3 w-full p-2 -mx-2 rounded text-[#5A5A5A] hover:bg-[#F9F8F6] hover:text-[#0F172A] transition-colors">
                <Settings size={18} className="text-[#8C8C8C]" />
                <span className="text-sm">Admin</span>
              </button>
            </div>
          </div>

          <div className="p-6 border-t border-[#E6E4DF]">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 rounded border border-[#E6E4DF]">
                <AvatarFallback className="bg-white text-[#0F172A] font-medium">PR</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-sm font-medium">Priya Raman</span>
                <span className="text-xs text-[#8C8C8C]">VP, Transformation</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F9F8F6]">
          {/* Top Bar */}
          <header className="h-16 flex items-center justify-between px-8 bg-[#F9F8F6] sticky top-0 z-30">
            <div className="hidden md:flex font-serif text-lg text-[#5A5A5A]">
              Executive Briefing
            </div>
            
            <div className="flex items-center gap-4 ml-auto">
              <div className="relative hidden md:block">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8C8C]" />
                <input 
                  type="text" 
                  placeholder="Search portfolios, projects..." 
                  className="pl-9 pr-4 py-1.5 text-sm bg-white border border-[#E6E4DF] rounded-full w-64 focus:outline-none focus:border-[#0F172A] transition-colors"
                />
              </div>
              <button className="relative p-2 text-[#5A5A5A] hover:text-[#0F172A] transition-colors">
                <Bell size={20} />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#DC2626] rounded-full border border-[#F9F8F6]"></span>
              </button>
            </div>
          </header>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 pb-24">
              
              <div className="mb-10">
                <h1 className="font-serif text-4xl font-medium tracking-tight mb-2">Q3 Portfolio Overview</h1>
                <p className="text-[#5A5A5A] text-lg font-light">
                  Status report for active enterprise initiatives as of October 24.
                </p>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                {[
                  { label: "Active Projects", value: "12", trend: "+2 this month", color: "text-[#0F172A]" },
                  { label: "Tasks Due This Week", value: "8", trend: "3 critical", color: "text-[#0F172A]" },
                  { label: "Overdue Tasks", value: "3", trend: "-2 from last week", color: "text-[#DC2626]" },
                  { label: "Pending Approvals", value: "5", trend: "Action required", color: "text-[#D97706]" },
                ].map((kpi, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl card-shadow flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300">
                    <span className="text-sm font-medium text-[#5A5A5A] uppercase tracking-wider">{kpi.label}</span>
                    <div className="mt-4 flex items-baseline gap-3">
                      <span className={`text-4xl font-serif ${kpi.color}`}>{kpi.value}</span>
                      <span className="text-xs text-[#8C8C8C]">{kpi.trend}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Data Viz & Summary Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                <div className="lg:col-span-2 bg-white rounded-2xl card-shadow p-8 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h2 className="font-serif text-xl font-medium">Portfolio Health Index</h2>
                      <p className="text-sm text-[#8C8C8C] mt-1">Aggregated completion confidence score over 6 months</p>
                    </div>
                    <Badge variant="outline" className="bg-[#ECFDF5] text-[#248253] border-transparent font-medium shadow-none text-xs">
                      94% Current
                    </Badge>
                  </div>
                  <div className="flex-1 min-h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={portfolioHealthData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0F172A" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#0F172A" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E6E4DF" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#8C8C8C' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#8C8C8C' }} domain={[70, 100]} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0F172A', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Area type="monotone" dataKey="value" stroke="#0F172A" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="flex flex-col gap-8">
                  <div className="bg-white rounded-2xl card-shadow p-6">
                    <h3 className="font-serif text-lg font-medium mb-4">My Task Summary</h3>
                    <div className="space-y-4">
                      {[
                        { label: "In Progress", count: 12, width: "60%", color: "bg-[#0F172A]" },
                        { label: "Not Started", count: 4, width: "20%", color: "bg-[#E6E4DF]" },
                        { label: "Completed", count: 28, width: "100%", color: "bg-[#ECFDF5]" },
                        { label: "Overdue", count: 3, width: "15%", color: "bg-[#DC2626]" },
                      ].map((stat, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1.5">
                            <span className="text-[#5A5A5A]">{stat.label}</span>
                            <span className="font-medium text-[#0F172A]">{stat.count}</span>
                          </div>
                          <div className="h-1.5 w-full bg-[#F9F8F6] rounded-full overflow-hidden">
                            <div className={`h-full ${stat.color}`} style={{ width: stat.width }}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#0F172A] text-white rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <AlertCircle size={64} />
                    </div>
                    <h3 className="font-serif text-lg font-medium mb-2 relative z-10">Pending Approvals</h3>
                    <p className="text-sm text-[#8C8C8C] mb-6 relative z-10">You have 5 decisions awaiting sign-off.</p>
                    <Button className="w-full bg-white text-[#0F172A] hover:bg-[#F9F8F6] font-medium border-0 transition-colors">
                      Review Approvals <ArrowRight size={16} className="ml-2" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Tasks Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-serif text-2xl font-medium tracking-tight">Tasks Due This Week</h2>
                    <Button variant="ghost" className="text-[#5A5A5A] hover:text-[#0F172A] text-sm">View All</Button>
                  </div>
                  <div className="bg-white rounded-2xl card-shadow overflow-hidden">
                    <div className="divide-y divide-[#E6E4DF]">
                      {tasksDue.map((task) => (
                        <div key={task.id} className="p-4 sm:p-5 flex items-start gap-4 hover:bg-[#FDFCFB] transition-colors group">
                          <button className="mt-1 w-5 h-5 rounded border border-[#E6E4DF] flex items-center justify-center text-transparent hover:border-[#0F172A] hover:text-[#0F172A] transition-colors">
                            <CheckSquare size={14} />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                              <h4 className="font-medium text-[#1A1A1A] text-sm truncate">{task.name}</h4>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-[#5A5A5A]">{task.due}</span>
                                <Badge variant="outline" className={`
                                  text-[10px] px-1.5 py-0 shadow-none border-transparent font-medium
                                  ${task.priority === 'P1' ? 'bg-[#FEF2F2] text-[#DC2626]' : 
                                    task.priority === 'P2' ? 'bg-[#FFFBEB] text-[#D97706]' : 
                                    'bg-[#F3F4F6] text-[#4B5563]'}
                                `}>
                                  {task.priority}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-[#8C8C8C] truncate">{task.project}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="font-serif text-2xl font-medium tracking-tight text-[#DC2626]">Attention Required</h2>
                  </div>
                  <div className="space-y-3">
                    {overdueTasks.map((task) => (
                      <div key={task.id} className="bg-white rounded-xl border border-[#FEF2F2] p-4 flex flex-col gap-3 relative overflow-hidden shadow-sm">
                        <div className="absolute top-0 left-0 w-1 h-full bg-[#DC2626]"></div>
                        <div className="flex justify-between items-start gap-4">
                          <h4 className="font-medium text-sm leading-tight text-[#1A1A1A]">{task.name}</h4>
                          <Badge variant="outline" className="bg-[#FEF2F2] text-[#DC2626] border-transparent text-[10px] whitespace-nowrap shrink-0">
                            {task.days}d overdue
                          </Badge>
                        </div>
                        <p className="text-xs text-[#8C8C8C] truncate">{task.project}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Projects Grid */}
              <div className="mb-12">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-serif text-2xl font-medium tracking-tight">Key Initiatives</h2>
                  <Button variant="outline" className="text-sm bg-white border-[#E6E4DF] text-[#1A1A1A] shadow-sm">
                    View Portfolio <ArrowRight size={14} className="ml-2" />
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {projects.map((project) => (
                    <div key={project.id} className="bg-white rounded-2xl card-shadow p-6 flex flex-col group hover:-translate-y-1 transition-transform duration-300">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            project.rag === 'green' ? 'bg-[#248253]' :
                            project.rag === 'amber' ? 'bg-[#D97706]' : 'bg-[#DC2626]'
                          }`}></div>
                          <Badge variant="outline" className={`
                            text-[10px] px-2 py-0.5 border-transparent uppercase tracking-wider shadow-none
                            ${
                              project.rag === 'green' ? 'bg-[#ECFDF5] text-[#248253]' :
                              project.rag === 'amber' ? 'bg-[#FFFBEB] text-[#D97706]' : 'bg-[#FEF2F2] text-[#DC2626]'
                            }
                          `}>
                            {project.rag.toUpperCase()}
                          </Badge>
                        </div>
                        <button className="text-[#8C8C8C] hover:text-[#0F172A] opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                      
                      <h3 className="font-medium text-[#1A1A1A] text-lg leading-snug mb-6 h-12 line-clamp-2">
                        {project.name}
                      </h3>
                      
                      <div className="space-y-5 flex-1">
                        <div>
                          <div className="flex justify-between text-xs mb-2">
                            <span className="text-[#5A5A5A]">Progress vs Baseline</span>
                            <span className="font-medium text-[#1A1A1A]">{project.progress}% / {project.baseline}%</span>
                          </div>
                          <div className="relative h-1.5 w-full bg-[#F9F8F6] rounded-full overflow-hidden mb-1">
                            <div className="absolute top-0 left-0 h-full bg-[#E6E4DF]" style={{ width: `${project.baseline}%` }}></div>
                            <div className={`absolute top-0 left-0 h-full ${
                              project.rag === 'green' ? 'bg-[#248253]' :
                              project.rag === 'amber' ? 'bg-[#D97706]' : 'bg-[#DC2626]'
                            }`} style={{ width: `${project.progress}%` }}></div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] text-[#8C8C8C] uppercase tracking-wider mb-1">Schedule Var</p>
                            <p className={`text-sm font-medium ${project.variance < 0 ? 'text-[#DC2626]' : 'text-[#248253]'}`}>
                              {project.variance > 0 ? '+' : ''}{project.variance} days
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[#8C8C8C] uppercase tracking-wider mb-1">Budget</p>
                            <p className="text-sm font-medium text-[#1A1A1A]">{project.budget}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[#8C8C8C] uppercase tracking-wider mb-1">Open Issues</p>
                            <p className="text-sm font-medium text-[#1A1A1A]">{project.issues}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[#8C8C8C] uppercase tracking-wider mb-1">Change Req</p>
                            <p className="text-sm font-medium text-[#1A1A1A]">{project.crs}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>
    </>
  );
}
