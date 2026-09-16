"use client";

import { useState } from "react";
import {
  X,
  User,
  MapPin,
  Package,
  ShoppingBag,
  Copy,
  CheckCircle,
  Store,
  Tag,
} from "lucide-react";
import type { RepeatBuyer } from "@/lib/shopify/repeat-buyers";

interface Props {
  buyer: RepeatBuyer;
  onClose: () => void;
}

function formatCurrency(val: number) {
  return `₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer"
      title="Copy"
    >
      {copied ? (
        <CheckCircle size={12} className="text-green-400" />
      ) : (
        <Copy size={12} />
      )}
    </button>
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
      <div className="flex items-center gap-2 mb-3 text-gray-400">
        {icon}
        <h3 className="text-xs font-medium uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
    </div>
  );
}

export function RepeatBuyerDetailPanel({ buyer, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-gray-900 border-l border-gray-700 z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">
                {buyer.customer_name}
              </h2>
              {buyer.is_reseller_candidate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-900/40 text-purple-300">
                  <Store size={10} />
                  Reseller candidate
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              {buyer.orders_count} orders · {buyer.total_units} units ·{" "}
              {formatCurrency(buyer.total_spent)}
            </p>
            {buyer.reseller_reasons.length > 0 && (
              <p className="text-xs text-purple-300/80 mt-1">
                {buyer.reseller_reasons.join(" · ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Avg order value" value={formatCurrency(buyer.avg_order_value)} />
            <Stat label="Units / order" value={String(buyer.avg_units_per_order)} />
            <Stat
              label="Reorder gap"
              value={
                buyer.avg_days_between === null
                  ? "—"
                  : `${buyer.avg_days_between}d`
              }
            />
            <Stat label="Since last order" value={`${buyer.days_since_last}d`} />
            <Stat label="Biggest order" value={formatCurrency(buyer.largest_order_value)} />
            <Stat label="Biggest order units" value={String(buyer.largest_order_units)} />
            <Stat
              label="COD / Prepaid"
              value={`${buyer.cod_count} / ${buyer.prepaid_count}`}
            />
            <Stat
              label="Lifetime orders"
              value={
                buyer.lifetime_orders_count > 0
                  ? String(buyer.lifetime_orders_count)
                  : "—"
              }
            />
          </div>

          {/* Contact */}
          <Section icon={<User size={16} />} title="Contact">
            <div className="space-y-2 text-sm">
              {buyer.phones.map((phone) => (
                <div key={phone} className="flex items-center gap-1 text-gray-300">
                  {phone}
                  <CopyButton text={phone} />
                </div>
              ))}
              {buyer.emails.map((email) => (
                <div key={email} className="flex items-center gap-1 text-gray-400">
                  {email}
                  <CopyButton text={email} />
                </div>
              ))}
              {buyer.phones.length === 0 && buyer.emails.length === 0 && (
                <p className="text-gray-600">No contact details on file.</p>
              )}
              <div className="flex items-center gap-1 flex-wrap pt-1">
                {buyer.stores.map((store) => (
                  <span
                    key={store}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700/50 text-gray-300"
                  >
                    {store}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          {/* Address */}
          {buyer.latest_address && (
            <Section icon={<MapPin size={16} />} title="Latest shipping address">
              <div className="flex items-start gap-1">
                <p className="text-sm text-gray-300 leading-relaxed">
                  {buyer.latest_address}
                </p>
                <CopyButton text={buyer.latest_address} />
              </div>
            </Section>
          )}

          {/* Discount codes used */}
          {buyer.discount_codes.length > 0 && (
            <Section icon={<Tag size={16} />} title="Discount codes used">
              <div className="flex items-center gap-1 flex-wrap">
                {buyer.discount_codes.map((code) => (
                  <span
                    key={code}
                    className="px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* What they buy */}
          <Section
            icon={<Package size={16} />}
            title={`What they buy (${buyer.products.length} product${buyer.products.length !== 1 ? "s" : ""})`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="text-left font-medium py-2">Product</th>
                    <th className="text-right font-medium py-2">Qty</th>
                    <th className="text-right font-medium py-2">Avg SRP</th>
                    <th className="text-right font-medium py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {buyer.products.map((p) => (
                    <tr key={p.key} className="border-b border-gray-800 last:border-0">
                      <td className="py-2 pr-3">
                        <p className="text-white">{p.title}</p>
                        <p className="text-xs text-gray-500">
                          {[p.variant_title, p.sku ? `SKU: ${p.sku}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td className="py-2 text-right text-gray-300">{p.quantity}</td>
                      <td className="py-2 text-right text-gray-300 whitespace-nowrap">
                        {formatCurrency(p.avg_unit_price)}
                      </td>
                      <td className="py-2 text-right text-white whitespace-nowrap">
                        {formatCurrency(p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Purchase history */}
          <Section
            icon={<ShoppingBag size={16} />}
            title={`Purchase history (${buyer.orders.length} order${buyer.orders.length !== 1 ? "s" : ""})`}
          >
            <div className="space-y-3">
              {buyer.orders.map((order) => (
                <div
                  key={`${order.store_name}-${order.id}`}
                  className={`border rounded-lg p-3 ${
                    order.is_dead
                      ? "border-red-900/40 bg-red-950/10"
                      : "border-gray-700/50 bg-gray-800/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">{order.name}</span>
                        <span className="text-xs text-gray-500">
                          {order.store_name}
                        </span>
                        {order.is_cod && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/30 text-blue-400">
                            COD
                          </span>
                        )}
                        {order.is_dead && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/30 text-red-400">
                            Cancelled — not counted
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDate(order.created_at)}
                        {order.days_since_previous !== null && (
                          <span className="text-gray-600">
                            {" "}
                            · {order.days_since_previous}d after previous order
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-white font-bold whitespace-nowrap">
                        {formatCurrency(order.total_price)}
                      </p>
                      <p className="text-xs text-gray-500">{order.units} units</p>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-800 space-y-1">
                    {order.line_items.map((li, idx) => (
                      <div
                        key={`${li.sku || li.title}-${idx}`}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="text-gray-300 truncate">
                          {li.title}
                          {li.variant_title && (
                            <span className="text-gray-500"> · {li.variant_title}</span>
                          )}
                          {li.sku && (
                            <span className="text-gray-600"> · {li.sku}</span>
                          )}
                        </span>
                        <span className="text-gray-400 whitespace-nowrap">
                          {li.quantity} × {formatCurrency(li.unit_price)} ={" "}
                          <span className="text-white">
                            {formatCurrency(li.line_total)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
