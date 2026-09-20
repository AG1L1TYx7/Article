"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { useCallback, useRef, useState } from "react";

interface ArticleEditorProps {
  initialContent?: object | string;
  onChange: (json: object, html: string) => void;
}

export function ArticleEditor({ initialContent, onChange }: ArticleEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    // Required for Next.js App Router: without this, Tiptap renders once
    // on the server and once on the client and React flags a hydration
    // mismatch, since the editor's DOM is inherently client-driven.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: false }),
      Image,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-neutral max-w-none min-h-[300px] focus:outline-none",
      },
    },
    // Emit once as soon as the editor exists, not just on edits. Without
    // this, a parent that tracks body content in state starts with an
    // empty string, so editing an existing article and saving *without
    // touching the body* would write that empty string back over the
    // article — silent data loss. onCreate makes "what the parent holds"
    // and "what's in the editor" agree from the first render.
    onCreate: ({ editor }) => {
      onChange(editor.getJSON(), editor.getHTML());
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON(), editor.getHTML());
    },
  });

  const insertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      setUploadError(null);
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/media/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.error ?? "Upload failed.");
          return;
        }
        editor.chain().focus().setImage({ src: data.url, alt: file.name }).run();
      } catch {
        setUploadError("Upload failed. Check your connection and try again.");
      } finally {
        setUploading(false);
      }
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="rounded-md border border-neutral-300">
      <Toolbar editor={editor} onPickImage={() => fileInputRef.current?.click()} uploading={uploading} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void insertImage(file);
          e.target.value = "";
        }}
      />
      {uploadError && <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</p>}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({
  editor,
  onPickImage,
  uploading,
}: {
  editor: Editor;
  onPickImage: () => void;
  uploading: boolean;
}) {
  const buttons: Array<{ label: string; active: boolean; onClick: () => void; title: string }> = [
    { label: "B", title: "Bold", active: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
    { label: "I", title: "Italic", active: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
    { label: "H2", title: "Heading", active: editor.isActive("heading", { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "H3", title: "Subheading", active: editor.isActive("heading", { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "•", title: "Bullet list", active: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Numbered list", active: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "❝", title: "Pull quote", active: editor.isActive("blockquote"), onClick: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-neutral-300 bg-neutral-50 px-2 py-1.5">
      {buttons.map((b) => (
        <button
          key={b.title}
          type="button"
          title={b.title}
          onClick={b.onClick}
          className={`min-w-[28px] rounded px-2 py-1 text-sm font-medium ${
            b.active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"
          }`}
        >
          {b.label}
        </button>
      ))}
      <button
        type="button"
        title="Link"
        onClick={() => {
          const url = window.prompt("Link URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        className={`min-w-[28px] rounded px-2 py-1 text-sm font-medium ${
          editor.isActive("link") ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"
        }`}
      >
        Link
      </button>
      <button
        type="button"
        title="Insert image"
        onClick={onPickImage}
        disabled={uploading}
        className="min-w-[28px] rounded px-2 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Image"}
      </button>
    </div>
  );
}
