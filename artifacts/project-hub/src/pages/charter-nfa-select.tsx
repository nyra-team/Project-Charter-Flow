import { Link } from "wouter";
import { Sparkles, FolderKanban, FileText, ArrowRight } from "lucide-react";

const OPTIONS = [
  {
    href: "/charters/new",
    icon: FolderKanban,
    title: "Project Charter / e-NFA for projects",
    subtitle: "Select this workflow for Projects",
    blurb:
      "Build a full Project Charter merged with the e-NFA note — business case, scope, benefits, strategic scoring, investment detail and governance sign-off.",
  },
  {
    href: "/charters/nfa-new",
    icon: FileText,
    title: "e-NFA for non projects",
    subtitle: "Select this workflow for non-projects",
    blurb:
      "Raise a standalone e-NFA note for non-project spend — background, requirement items, recommendation and the approval signatory chain.",
  },
] as const;

export default function CharterNfaSelect() {
  return (
    <div className="space-y-6">
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative p-6 lg:p-8">
          <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
            Charter + e-NFA · AI assisted
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground flex items-center gap-3">
            <Sparkles size={26} className="text-primary" />
            Start a Business Case
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            Choose the workflow that fits your initiative. Projects use the merged Project
            Charter + e-NFA; non-project spend uses the standalone e-NFA.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <Link key={opt.href} href={opt.href}>
              <button className="group w-full text-left glass-surface lift-card ph-rise rounded-2xl p-7 flex flex-col h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
                <div className="flex items-start justify-between mb-5">
                  <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
                    <Icon size={22} />
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-card-foreground tracking-tight">{opt.title}</h3>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{opt.blurb}</p>
                <span className="mt-auto pt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-card-foreground group-hover:gap-2.5 transition-all">
                  Start workflow
                  <ArrowRight size={15} className="text-primary" />
                </span>
              </button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
