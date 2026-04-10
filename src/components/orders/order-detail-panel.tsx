"use client";

import {
  X,
  Package,
  User,
  MapPin,
  Truck,
  CreditCard,
  Tag,
  MessageSquare,
  ExternalLink,
  Copy,
  CheckCircle,
} from "lucide-react";
import { useState } from "react";
import type { ShopifyOrder } from "@/lib/shopify/types";

interface Props {
  order: ShopifyOrder;
  isAdmin: boolean;
  onClose: () => void;
}

function formatCurrency(val: string) {
  const num = parseFloat(val);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
      title="Copy"
    >
      {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function StatusBadge({ status, type }: { status: string | null; type: "payment" | "fulfillment" }) {
  if (type === "payment") {
    const styles: Record<string, string> = {
      paid: "bg-green-900/30 text-green-400",
      pending: "bg-yellow-900/30 text-yellow-400",
      refunded: "bg-red-900/30 text-red-400",
      partially_refunded: "bg-orange-900/30 text-orange-400",
      voided: "bg-gray-700/50 text-gray-400",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status || "pending"] || styles.pending}`}>
        {(status || "pending").replace("_", " ")}
      </span>
    );
  }
  const styles: Record<string, string> = {
    fulfilled: "bg-green-900/30 text-green-400",
    partial: "bg-yellow-900/30 text-yellow-400",
    unfulfilled: "bg-gray-700/50 text-gray-400",
  };
  const label = status || "unfulfilled";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[label] || styles.unfulfilled}`}>
      {label}
    </span>
  );
}

export function OrderDetailPanel({ order, isAdmin, onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-gray-900 border-l border-gray-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-white">{order.name}</h2>
            <p className="text-sm text-gray-400">{order.store_name} · {formatDate(order.created_at)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Status Row */}
          <div className="flex items-center gap-3">
            <StatusBadge status={order.financial_status} type="payment" />
            <StatusBadge status={order.fulfillment_status} type="fulfillment" />
            {order.is_cod && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/30 text-blue-400">
                COD
              </span>
            )}
            {order.age_level === "warning" && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400">
                {order.age_days}d unfulfilled
              </span>
            )}
            {order.age_level === "danger" && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400">
                {order.age_days}d unfulfilled!
              </span>
            )}
          </div>

          {/* Customer */}
          <Section icon={<User size={16} />} title="Customer">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-medium">{order.customer_name}</span>
                {order.customer_orders_count > 1 && (
                  <span className="text-xs text-gray-500">
                    {order.customer_orders_count} orders · {formatCurrency(order.customer_total_spent)} total
                  </span>
                )}
              </div>
              {order.customer_email && (
                <div className="flex items-center gap-1 text-sm text-gray-400">
                  {order.customer_email}
                  <CopyButton text={order.customer_email} />
                </div>
              )}
              {order.customer_phone && (
                <div className="flex items-center gap-1 text-sm text-gray-400">
                  {order.customer_phone}
                  <CopyButton text={order.customer_phone} />
                </div>
              )}
            </div>
          </Section>

          {/* Shipping Address */}
          {order.shipping_address && (
            <Section icon={<MapPin size={16} />} title="Shipping Address">
              <p className="text-sm text-gray-300 leading-relaxed">
                {order.shipping_address}
              </p>
            </Section>
          )}

          {/* Line Items */}
          <Section icon={<Package size={16} />} title={`Items (${order.line_items.length})`}>
            <div className="space-y-2">
              {order.line_items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {item.variant_title && <span>{item.variant_title}</span>}
                      {item.sku && <span>SKU: {item.sku}</span>}
                      <span>×{item.quantity}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <span className="text-sm text-white ml-3">
                      {formatCurrency(item.price)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Order Totals (admin only) */}
          {isAdmin && (
            <Section icon={<CreditCard size={16} />} title="Totals">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Subtotal</span>
                  <span className="text-gray-300">{formatCurrency(order.subtotal_price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Shipping</span>
                  <span className="text-gray-300">{formatCurrency(order.shipping_price)}</span>
                </div>
                {parseFloat(order.total_discounts) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Discount</span>
                    <span className="text-green-400">-{formatCurrency(order.total_discounts)}</span>
                  </div>
                )}
                {parseFloat(order.total_tax) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Tax</span>
                    <span className="text-gray-300">{formatCurrency(order.total_tax)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-gray-700">
                  <span className="text-white font-medium">Total</span>
                  <span className="text-white font-bold">{formatCurrency(order.total_price)}</span>
                </div>
              </div>
            </Section>
          )}

          {/* Payment */}
          <Section icon={<CreditCard size={16} />} title="Payment">
            <p className="text-sm text-gray-300 capitalize">{order.gateway || "Unknown"}</p>
            {order.discount_codes.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Discount codes:</p>
                <div className="flex flex-wrap gap-1">
                  {order.discount_codes.map((dc) => (
                    <span key={dc.code} className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300">
                      {dc.code} (-{formatCurrency(dc.amount)})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Fulfillment / Tracking */}
          <Section icon={<Truck size={16} />} title="Fulfillment">
            {order.tracking_number ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Tracking:</span>
                  <span className="text-sm text-white font-mono">{order.tracking_number}</span>
                  <CopyButton text={order.tracking_number} />
                </div>
                {order.tracking_company && (
                  <p className="text-sm text-gray-400">Carrier: {order.tracking_company}</p>
                )}
                {order.fulfilled_at && (
                  <p className="text-sm text-gray-400">Fulfilled: {formatDate(order.fulfilled_at)}</p>
                )}
                {order.tracking_url && (
                  <a
                    href={order.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                  >
                    Track package <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No tracking information yet</p>
            )}
          </Section>

          {/* Notes & Tags */}
          {(order.note || order.tags) && (
            <Section icon={<MessageSquare size={16} />} title="Notes & Tags">
              {order.note && (
                <p className="text-sm text-gray-300 bg-gray-800/50 rounded-lg p-3 mb-2">
                  {order.note}
                </p>
              )}
              {order.tags && (
                <div className="flex flex-wrap gap-1">
                  {order.tags.split(",").map((tag) => (
                    <span
                      key={tag.trim()}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300"
                    >
                      <Tag size={10} />
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-400">{icon}</span>
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}
