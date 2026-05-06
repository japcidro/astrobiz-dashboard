import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createVapiCall, VapiError } from "@/lib/call-confirmer/vapi";
import {
  buildVapiCallRequest,
  type OrderContext,
} from "@/lib/call-confirmer/assistant";
import type { CallConfirmerConfig } from "@/lib/call-confirmer/types";

export const dynamic = "force-dynamic";

interface InitiateBody {
  store_id?: string;
  customer_phone?: string;
  is_test_call?: boolean;
  order?: Partial<OrderContext>;
  shopify_order_id?: string;
  shopify_order_name?: string;
}

const SAMPLE_ORDER: OrderContext = {
  customer_name: "Juan Cruz",
  order_name: "#TEST-001",
  order_items: "1x Hair Patches Set, 1x Toner",
  total: "1499.00",
  address: "123 Sample Street, Quezon City, Metro Manila",
  payment_method: "Cash on Delivery",
  store_name: "Astrobiz Test Store",
};

export async function POST(req: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: InitiateBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.store_id) {
    return Response.json({ error: "store_id required" }, { status: 400 });
  }
  if (!body.customer_phone || !/^\+\d{10,15}$/.test(body.customer_phone)) {
    return Response.json(
      { error: "customer_phone must be E.164 format" },
      { status: 400 }
    );
  }

  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    return Response.json(
      { error: "VAPI_PHONE_NUMBER_ID missing in env" },
      { status: 500 }
    );
  }

  const supabase = await createClient();

  // 1. Load config + verify store
  const { data: config, error: configErr } = await supabase
    .from("call_confirmer_configs")
    .select("*")
    .eq("store_id", body.store_id)
    .maybeSingle();

  if (configErr) return Response.json({ error: configErr.message }, { status: 500 });
  if (!config) {
    return Response.json(
      { error: "No config for this store. Configure in Settings tab first." },
      { status: 400 }
    );
  }
  if (!config.enabled) {
    return Response.json(
      { error: "Call Confirmer is disabled for this store" },
      { status: 400 }
    );
  }
  if (!config.voice_id) {
    return Response.json(
      { error: "No voice selected. Set one in Settings tab." },
      { status: 400 }
    );
  }

  // 2. Budget check (uses our SQL helper)
  const { data: hasBudget, error: budgetErr } = await supabase.rpc(
    "call_confirmer_has_budget",
    { p_store_id: body.store_id }
  );
  if (budgetErr) {
    return Response.json({ error: budgetErr.message }, { status: 500 });
  }
  if (!hasBudget) {
    return Response.json(
      {
        error:
          "Daily budget reached for this store. Resets at midnight PH time. Increase cap in Settings if needed.",
      },
      { status: 429 }
    );
  }

  // 3. Get store name for the assistant context
  const { data: store } = await supabase
    .from("shopify_stores")
    .select("name")
    .eq("id", body.store_id)
    .maybeSingle();
  const storeName = store?.name ?? "Astrobiz";

  // 4. Build order context.
  // - Test call with passed-in order: use it (real Shopify sample fetched on UI)
  // - Test call without order: fallback synthetic SAMPLE_ORDER
  // - Real call: use passed-in order data
  const isTest = body.is_test_call ?? false;
  const passedOrder = body.order;
  const hasFullPassedOrder =
    passedOrder &&
    passedOrder.customer_name &&
    passedOrder.order_name &&
    passedOrder.order_items &&
    passedOrder.total;

  const order: OrderContext = hasFullPassedOrder
    ? {
        customer_name: passedOrder.customer_name!,
        order_name: passedOrder.order_name!,
        order_items: passedOrder.order_items!,
        total: passedOrder.total!,
        address: passedOrder.address ?? "your shipping address",
        payment_method: passedOrder.payment_method ?? "Cash on Delivery",
        store_name: storeName,
      }
    : isTest
    ? { ...SAMPLE_ORDER, store_name: storeName }
    : {
        customer_name: passedOrder?.customer_name ?? "Customer",
        order_name:
          passedOrder?.order_name ?? body.shopify_order_name ?? "your order",
        order_items: passedOrder?.order_items ?? "your items",
        total: passedOrder?.total ?? "0.00",
        address: passedOrder?.address ?? "your shipping address",
        payment_method: passedOrder?.payment_method ?? "Cash on Delivery",
        store_name: storeName,
      };

  if (!isTest && !body.shopify_order_id) {
    return Response.json(
      { error: "shopify_order_id required for non-test calls" },
      { status: 400 }
    );
  }

  // 5. Compute attempt number for this order (real calls only)
  let attemptNumber = 1;
  if (!isTest && body.shopify_order_id) {
    const { count } = await supabase
      .from("call_attempts")
      .select("*", { count: "exact", head: true })
      .eq("shopify_order_id", body.shopify_order_id)
      .eq("is_test_call", false);
    attemptNumber = (count ?? 0) + 1;

    if (attemptNumber > config.max_attempts) {
      return Response.json(
        {
          error: `Max attempts (${config.max_attempts}) reached for this order`,
        },
        { status: 429 }
      );
    }
  }

  // 6. Insert queued attempt row using service client (bypasses RLS for the insert)
  const serviceClient = createServiceClient();
  const { data: attempt, error: attemptErr } = await serviceClient
    .from("call_attempts")
    .insert({
      store_id: body.store_id,
      shopify_order_id: body.shopify_order_id ?? `test-${Date.now()}`,
      shopify_order_name: order.order_name,
      customer_name: order.customer_name,
      customer_phone: body.customer_phone,
      order_snapshot: order,
      attempt_number: attemptNumber,
      is_test_call: isTest,
      initiated_by: employee.id,
      status: "queued",
      provider: "vapi",
    })
    .select("*")
    .single();

  if (attemptErr || !attempt) {
    return Response.json(
      { error: attemptErr?.message ?? "Failed to record attempt" },
      { status: 500 }
    );
  }

  // 7. Fire the call to Vapi
  const callRequest = buildVapiCallRequest(
    {
      config: config as CallConfirmerConfig,
      order,
      customerPhone: body.customer_phone,
      isTestCall: isTest,
      metadata: {
        attempt_id: attempt.id,
        store_id: body.store_id,
        shopify_order_id: attempt.shopify_order_id,
        is_test_call: isTest,
      },
    },
    phoneNumberId
  );

  try {
    const vapiCall = await createVapiCall(callRequest);

    // 8. Update attempt with provider call id + status
    await serviceClient
      .from("call_attempts")
      .update({
        provider_call_id: vapiCall.id,
        status: "ringing",
        started_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    return Response.json({
      attempt_id: attempt.id,
      provider_call_id: vapiCall.id,
      status: "ringing",
    });
  } catch (e: unknown) {
    const errMsg =
      e instanceof VapiError
        ? `Vapi ${e.status}: ${e.body.slice(0, 300)}`
        : e instanceof Error
        ? e.message
        : "Unknown error";

    // Mark attempt as failed
    await serviceClient
      .from("call_attempts")
      .update({
        status: "failed",
        outcome: "unreachable",
        handoff_reason: `Vapi error: ${errMsg}`,
        ended_at: new Date().toISOString(),
      })
      .eq("id", attempt.id);

    return Response.json({ error: errMsg }, { status: 502 });
  }
}
