import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A data table on the canvas: hairlines between rows, mono numbers right-aligned,
 * the selected row in the accent tint. Compose it like plain HTML:
 *
 *   <Table>
 *     <TableHead><TableRow><TableHeader>Order</TableHeader><TableHeader num>Total</TableHeader></TableRow></TableHead>
 *     <TableBody><TableRow selected><TableCell>#20481</TableCell><TableCell num>₱1,840</TableCell></TableRow></TableBody>
 *   </Table>
 */
export function Table({ className, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function TableHead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

interface RowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  /** Lift the row on hover; for rows that open something. */
  interactive?: boolean;
}

export function TableRow({ selected, interactive, className, ...rest }: RowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-line last:border-b-0",
        selected && "bg-accent-soft",
        interactive && "cursor-pointer hover:bg-raised",
        className
      )}
      {...rest}
    />
  );
}

interface CellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** A numeric column: numeric face, tabular figures, right-aligned. */
  num?: boolean;
}

export function TableHeader({ num, className, ...rest }: CellProps) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2 text-left text-label font-normal text-muted",
        num && "text-right",
        className
      )}
      {...rest}
    />
  );
}

export function TableCell({ num, className, ...rest }: CellProps) {
  return (
    <td
      className={cn(
        "px-3 py-row align-middle text-fg",
        num && "whitespace-nowrap text-right font-num",
        className
      )}
      {...rest}
    />
  );
}
