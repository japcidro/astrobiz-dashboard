// Drains a Supabase query past PostgREST's silent 1000-row cap by paging
// with .range(). Use this anywhere a SELECT could plausibly exceed 1000
// rows — the bare client default truncates without error, so summary
// counts and rate calculations end up wrong without a peep in the logs.
//
// Pass a builder factory that returns a fresh PostgrestFilterBuilder for
// each page (we apply .order() and .range() on top). The order column
// must be stable across pages — usually the table's primary key works
// fine, but any column with no ties relative to filter scope is OK.

// PostgrestFilterBuilder is a "thenable" — it resolves to a response when
// awaited but isn't a real Promise. Loose-typing the builder avoids
// having to plumb the full @supabase/postgrest-js generic chain through
// every call site.
type AwaitableBuilder<Row> = {
  order: (column: string, options?: { ascending?: boolean }) => AwaitableBuilder<Row>;
  range: (from: number, to: number) => PromiseLike<{
    data: Row[] | null;
    error: { message: string } | null;
  }>;
};

export async function fetchAllRows<Row>(
  buildPage: () => unknown,
  options: {
    pageSize?: number;
    orderColumn?: string;
    ascending?: boolean;
  } = {}
): Promise<{ data: Row[]; error: Error | null }> {
  const pageSize = options.pageSize ?? 1000;
  const orderColumn = options.orderColumn ?? "id";
  const ascending = options.ascending ?? true;

  const all: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const builder = buildPage() as AwaitableBuilder<Row>;
    const res = await builder
      .order(orderColumn, { ascending })
      .range(from, from + pageSize - 1);
    if (res.error) {
      return { data: all, error: new Error(res.error.message) };
    }
    const page = res.data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: all, error: null };
}
