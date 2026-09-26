"use client";

import { useState, useTransition } from "react";
import { setHomeDistrict } from "../issues/actions";

interface DistrictOption {
  id: string;
  name: string;
  nameNe: string;
  province: { name: string };
}

/**
 * Where a member lives, which is how district alerts find them.
 *
 * Optional, and said so plainly. Somebody reporting on their own district
 * may not want to be recorded as living in it, and a platform that
 * demanded a location before letting anybody read would lose the readers
 * it exists for. The only thing it unlocks is being told — so the label
 * describes that, rather than asking for an address.
 */
export function HomeDistrict({
  districts,
  current,
}: {
  districts: DistrictOption[];
  current: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    setValue(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setHomeDistrict(next || null);
      if (result.ok) setSaved(true);
      else setError(result.error ?? "Could not save that.");
    });
  }

  return (
    <div className="mt-4">
      <label className="field">
        <span className="label">Your district</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className="input"
        >
          <option value="">Not set — I would rather not say</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.nameNe} ({d.province.name})
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-xs text-ink-3">
        Used for one thing: telling you when a verified report concerns your district. Nothing
        else on the site changes, and you can clear it at any time.
      </p>
      {saved && (
        <p className="mt-2 text-xs text-ink-2" role="status">
          Saved.
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
