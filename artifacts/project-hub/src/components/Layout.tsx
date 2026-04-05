import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import {
  Briefcase,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/charters", label: "Charters", icon: FileText },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: Briefcase },
];

const ROLES = [
  "initiator",
  "hod",
  "executive_director",
  "cfo",
  "scm",
  "chairman",
  "finance",
  "pmo",
  "pm",
  "team_member",
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { role, setRole } = useUserStore();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col text-sidebar-foreground">
        <div className="p-4 border-b border-sidebar-border flex items-center gap-2">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground p-1.5 rounded-md">
            <Briefcase size={20} />
          </div>
          <span className="font-bold text-lg tracking-tight">Project Hub</span>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border flex flex-col gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              Simulate Role
            </label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-8 text-xs">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.replace("_", " ").toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 rounded border border-sidebar-border">
              <AvatarImage src="" />
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs rounded">
                JD
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">John Doe</p>
              <p className="text-xs text-sidebar-foreground/50 truncate capitalize">
                {role.replace("_", " ")}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-14 flex-shrink-0 border-b border-border bg-card flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold text-foreground capitalize">
              {location.split("/")[1] || "Dashboard"}
            </h1>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <button className="p-2 hover:bg-muted rounded-full transition-colors">
              <Settings size={18} />
            </button>
            <button className="p-2 hover:bg-muted rounded-full transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 bg-background">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
