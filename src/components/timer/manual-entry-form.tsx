"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { addManualEntry } from "@/lib/time-actions";

export function ManualEntryForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await addManualEntry(formData);
        setSuccess(true);
        setIsOpen(false);
        setTimeout(() => setSuccess(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add entry");
      }
    });
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Manual Entry</h2>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          <Plus size={16} />
          {isOpen ? "Cancel" : "Add Entry"}
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        Forgot to start the timer? Add your hours manually here.
      </p>

      {success && (
        <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
          Entry added successfully!
        </div>
      )}

      {isOpen && (
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Date</label>
            <input
              type="date"
              name="date"
              defaultValue={today}
              max={today}
              required
              className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Hours
              </label>
              <input
                type="number"
                name="hours"
                min="0"
                max="24"
                defaultValue="0"
                required
                className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Minutes
              </label>
              <input
                type="number"
                name="minutes"
                min="0"
                max="59"
                defaultValue="0"
                required
                className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1.5">
              Notes (optional)
            </label>
            <input
              type="text"
              name="notes"
              placeholder="e.g., Forgot to start timer"
              className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? "Adding..." : "Add Manual Entry"}
          </button>
        </form>
      )}
    </div>
  );
}
