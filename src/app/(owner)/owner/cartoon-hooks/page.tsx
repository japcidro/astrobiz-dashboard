import { redirect } from "next/navigation";

// Cartoon Hooks became the Cartoon Generator; old links still land there.
export default function CartoonHooksRedirect() {
  redirect("/owner/cartoon-generator");
}
