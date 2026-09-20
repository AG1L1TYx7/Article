"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCategory, updateCategory } from "./actions";
import { ActionButton } from "@/components/ActionButton";
import { PenIcon, TrashIcon } from "@/components/icons";
import { plural } from "@/lib/format";

export interface CategoryRowData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  articles: number;
}

export function CategoryRow({ category }: { category: CategoryRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await updateCategory(category.id, { name: name.trim(), description: description.trim() });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't save that.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-col gap-3 bg-surface-2/50 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label htmlFor={`name-${category.id}`} className="label">
              Name
            </label>
            <input
              id={`name-${category.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoFocus
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor={`description-${category.id}`} className="label">
              Description
            </label>
            <input
              id={`description-${category.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              className="input"
            />
          </div>
        </div>
        <p className="hint">
          The address stays <span className="font-mono">/category/{category.slug}</span> — it is in every link to
          this section.
        </p>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={pending || !name.trim()} className="btn btn-primary btn-sm">
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setName(category.name);
              setDescription(category.description ?? "");
              setError(null);
              setEditing(false);
            }}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{category.name}</p>
        <p className="text-xs text-ink-3">
          <span className="font-mono">/category/{category.slug}</span> · {plural(category.articles, "article")}
          {category.description ? ` · ${category.description}` : ""}
        </p>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm gap-1">
        <PenIcon size={14} /> Edit
      </button>
      <ActionButton
        action={deleteCategory}
        args={[category.id]}
        className="btn btn-ghost btn-sm gap-1 text-danger"
        pendingLabel="Deleting…"
        disabled={category.articles > 0}
        title={
          category.articles > 0
            ? `${plural(category.articles, "article")} still use this section — move them first`
            : "Delete this section"
        }
        confirm={`Delete the "${category.name}" section? This cannot be undone.`}
      >
        <TrashIcon size={14} /> Delete
      </ActionButton>
    </div>
  );
}
