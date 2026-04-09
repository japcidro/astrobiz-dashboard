"use client";

import { Loader2, Save, ChevronLeft, ChevronRight } from "lucide-react";

interface WizardNavProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSaveDraft: () => void;
  saving: boolean;
  canNext: boolean;
  nextLabel?: string;
}

export function WizardNav({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSaveDraft,
  saving,
  canNext,
  nextLabel,
}: WizardNavProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  return (
    <div className="flex items-center justify-between border-t border-gray-700/50 pt-4 mt-6">
      <div>
        {!isFirst && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mr-4">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === currentStep
                  ? "w-6 bg-white"
                  : i < currentStep
                    ? "w-3 bg-gray-500"
                    : "w-3 bg-gray-700"
              }`}
            />
          ))}
        </div>

        <button
          onClick={onSaveDraft}
          disabled={saving}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Save Draft
        </button>

        {!isLast ? (
          <button
            onClick={onNext}
            disabled={!canNext}
            className="flex items-center gap-1.5 bg-white text-gray-900 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer hover:bg-gray-100"
          >
            {nextLabel || "Next"}
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
