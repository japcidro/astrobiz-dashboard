interface Props {
  title: string;
  /** One line under the title: what the page covers, or today's numbers. */
  subtitle?: React.ReactNode;
  /** A status pill or the page's one primary action, on the right. */
  actions?: React.ReactNode;
}

/** The header every page opens with. Display face, sentence case. */
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
