import { CartoonHooksList } from "@/components/cartoon/cartoon-hooks-list";

export const dynamic = "force-dynamic";

// Owner and marketing: the (owner) layout already 404s everyone else.
export default function CartoonHooksPage() {
  return <CartoonHooksList />;
}
