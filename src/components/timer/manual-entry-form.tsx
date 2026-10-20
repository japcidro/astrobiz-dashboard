"use client";

import { useState, useTransition } from "react";
import { addManualEntry } from "@/lib/time-actions";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Note } from "@/components/ui/note";

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
    <Panel
      title="Manual entry"
      actions={
        <Button variant="ghost" size="sm" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? "Cancel" : "Add entry"}
        </Button>
      }
    >
      <p className="text-sm text-muted">
        Forgot to start the timer? Add the hours here and they count toward today.
      </p>

      {success && (
        <p className="mt-3 text-sm text-good" role="status">
          Entry added.
        </p>
      )}

      {isOpen && (
        <form action={handleSubmit} className="mt-4 space-y-4">
          <Field label="Date" htmlFor="manual-date">
            <Input
              id="manual-date"
              type="date"
              name="date"
              defaultValue={today}
              max={today}
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours" htmlFor="manual-hours">
              <Input
                id="manual-hours"
                type="number"
                name="hours"
                min="0"
                max="24"
                defaultValue="0"
                required
                className="font-num"
              />
            </Field>
            <Field label="Minutes" htmlFor="manual-minutes">
              <Input
                id="manual-minutes"
                type="number"
                name="minutes"
                min="0"
                max="59"
                defaultValue="0"
                required
                className="font-num"
              />
            </Field>
          </div>

          <Field label="Notes (optional)" htmlFor="manual-notes">
            <Input
              id="manual-notes"
              type="text"
              name="notes"
              placeholder="e.g. forgot to start the timer"
            />
          </Field>

          {error && <Note tone="bad">{error}</Note>}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Adding…" : "Add entry"}
          </Button>
        </form>
      )}
    </Panel>
  );
}
