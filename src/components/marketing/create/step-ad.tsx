"use client";

import type { AdFormData, CTAType } from "@/lib/facebook/types";
import { CreativeUploader } from "./creative-uploader";
import { PageSelector } from "./page-selector";

const CTA_OPTIONS: { value: CTAType; label: string }[] = [
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "ORDER_NOW", label: "Order Now" },
  { value: "GET_OFFER", label: "Get Offer" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "BOOK_NOW", label: "Book Now" },
  { value: "CONTACT_US", label: "Contact Us" },
];

interface StepAdProps {
  data: AdFormData;
  adAccountId: string;
  onUpdate: (updates: Partial<AdFormData>) => void;
}

export function StepAd({ data, adAccountId, onUpdate }: StepAdProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">Ad Creative</h2>
        <p className="text-gray-400 text-sm">
          Upload your creative, write your copy, and set your CTA.
        </p>
      </div>

      {/* Ad Name */}
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">Ad Name</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g. Summer Sale - Video V1"
          className="w-full max-w-lg bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Facebook Page */}
      <div className="max-w-lg">
        <PageSelector
          selectedPageId={data.page_id}
          onChange={(pageId) => onUpdate({ page_id: pageId })}
        />
      </div>

      {/* Creative Upload */}
      <div className="max-w-lg">
        <CreativeUploader
          type={data.creative_type}
          adAccountId={adAccountId}
          fileName={data.file_name}
          previewUrl={data.file_preview_url}
          imageHash={data.image_hash}
          videoId={data.video_id}
          onUploaded={(result) =>
            onUpdate({
              image_hash: result.image_hash,
              video_id: result.video_id,
              file_name: result.file_name,
              file_preview_url: result.file_preview_url,
            })
          }
          onClear={() =>
            onUpdate({
              image_hash: null,
              video_id: null,
              file_name: null,
              file_preview_url: null,
            })
          }
          onTypeChange={(type) =>
            onUpdate({
              creative_type: type,
              image_hash: null,
              video_id: null,
              file_name: null,
              file_preview_url: null,
            })
          }
        />
      </div>

      {/* Ad Copy */}
      <div className="space-y-4 max-w-lg">
        <h3 className="text-sm font-medium text-white">Ad Copy</h3>

        {/* Primary Text */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-400">Primary Text</label>
            <span
              className={`text-xs ${
                data.primary_text.length > 125
                  ? "text-yellow-400"
                  : "text-gray-600"
              }`}
            >
              {data.primary_text.length}/125
            </span>
          </div>
          <textarea
            value={data.primary_text}
            onChange={(e) => onUpdate({ primary_text: e.target.value })}
            placeholder="Main ad text that appears above the image/video..."
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Headline */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-400">Headline</label>
            <span
              className={`text-xs ${
                data.headline.length > 40
                  ? "text-yellow-400"
                  : "text-gray-600"
              }`}
            >
              {data.headline.length}/40
            </span>
          </div>
          <input
            type="text"
            value={data.headline}
            onChange={(e) => onUpdate({ headline: e.target.value })}
            placeholder="Bold headline below the creative"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-400">Description</label>
            <span
              className={`text-xs ${
                data.description.length > 30
                  ? "text-yellow-400"
                  : "text-gray-600"
              }`}
            >
              {data.description.length}/30
            </span>
          </div>
          <input
            type="text"
            value={data.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Short description under headline"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* CTA */}
      <div className="max-w-lg">
        <label className="block text-sm text-gray-400 mb-2">
          Call to Action
        </label>
        <div className="flex flex-wrap gap-2">
          {CTA_OPTIONS.map((cta) => (
            <button
              key={cta.value}
              onClick={() => onUpdate({ call_to_action: cta.value })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                data.call_to_action === cta.value
                  ? "bg-white text-gray-900"
                  : "bg-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              {cta.label}
            </button>
          ))}
        </div>
      </div>

      {/* Website URL */}
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">
            Website URL
          </label>
          <input
            type="url"
            value={data.website_url}
            onChange={(e) => onUpdate({ website_url: e.target.value })}
            placeholder="https://yourstore.com/sale"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* URL Parameters */}
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">
            URL Parameters{" "}
            <span className="text-gray-600">(for tracking)</span>
          </label>
          <input
            type="text"
            value={data.url_parameters}
            onChange={(e) => onUpdate({ url_parameters: e.target.value })}
            placeholder="utm_source=facebook&utm_medium=paid"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Preview */}
      {(data.primary_text || data.headline || data.file_preview_url) && (
        <div className="max-w-sm">
          <h3 className="text-sm font-medium text-white mb-3">Preview</h3>
          <div className="bg-white rounded-xl overflow-hidden shadow-lg">
            {/* Page header */}
            <div className="px-3 pt-3 pb-2 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gray-200" />
              <div>
                <p className="text-xs font-semibold text-gray-900">
                  Your Page
                </p>
                <p className="text-[10px] text-gray-500">Sponsored</p>
              </div>
            </div>
            {/* Primary text */}
            {data.primary_text && (
              <p className="px-3 pb-2 text-sm text-gray-900 leading-relaxed">
                {data.primary_text}
              </p>
            )}
            {/* Creative */}
            {data.file_preview_url ? (
              <img
                src={data.file_preview_url}
                alt="Ad preview"
                className="w-full aspect-square object-cover"
              />
            ) : (
              <div className="w-full aspect-square bg-gray-100 flex items-center justify-center">
                <span className="text-gray-400 text-sm">
                  Upload creative above
                </span>
              </div>
            )}
            {/* Bottom section */}
            <div className="px-3 py-2.5 border-t border-gray-100 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                {data.website_url && (
                  <p className="text-[10px] text-gray-500 uppercase truncate">
                    {data.website_url.replace(/^https?:\/\//, "").split("/")[0]}
                  </p>
                )}
                {data.headline && (
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {data.headline}
                  </p>
                )}
                {data.description && (
                  <p className="text-xs text-gray-500 truncate">
                    {data.description}
                  </p>
                )}
              </div>
              {data.call_to_action && (
                <span className="ml-2 bg-gray-200 text-gray-900 text-xs font-semibold px-3 py-1.5 rounded flex-shrink-0">
                  {CTA_OPTIONS.find((c) => c.value === data.call_to_action)
                    ?.label || data.call_to_action}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
