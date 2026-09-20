"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCategory } from "./actions";
import { slugify } from "@/lib/slugify";

export function CategoryForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    const result = await createCategory(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't add that category.");
      return;
    }
    setDone(`Added ${name.trim()}.`);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-3 p-4 lg:self-start">
      <h2 className="font-medium">Add category</h2>
      <div className="field">
        <label htmlFor="category-name" className="label">
          Name
        </label>
        <input
          id="category-name"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          placeholder="Business"
          required
          maxLength={80}
          className="input"
        />
      </div>
      <div className="field">
        <label htmlFor="category-slug" className="label">
          Slug
        </label>
        <input
          id="category-slug"
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugTouched(true);
          }}
          placeholder="business"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          className="input font-mono text-xs"
        />
        <p className="hint">
          Becomes <span className="font-mono">/category/{slug || "…"}</span>. Cannot be changed later.
        </p>
      </div>
      <div className="field">
        <label htmlFor="category-description" className="label">
          Description <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <input
          id="category-description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Markets, companies and the economy"
          maxLength={300}
          className="input"
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-ok" role="status">
          {done}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
