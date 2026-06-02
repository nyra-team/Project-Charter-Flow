// Consistent page + section headers — larger type, generous spacing, no heavy
// borders. Used to give every redesigned page the same Monday-clean top band.

import React from "react";

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  actions?: React.ReactNode;
  /** Optional row beneath the title (filters, chips, etc.). */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 ${className}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <span className="mt-0.5 p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <Icon size={20} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-[28px] font-semibold font-display tracking-tight text-foreground leading-tight">
              {title}
            </h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
