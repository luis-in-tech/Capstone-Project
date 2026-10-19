import { createContext, useContext } from 'react';

export const SidebarCollapsedContext = createContext(false);

export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const isCollapsed = useContext(SidebarCollapsedContext);

  return (
    <div>
      <h1 className={`text-2xl font-bold tracking-tight text-foreground ${isCollapsed ? '' : 'lg:sr-only'}`}>
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
