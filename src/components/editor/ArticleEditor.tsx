"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useRef, useState } from "react";
import { uploadFile } from "@/lib/uploadClient";
import { ImageIcon, LinkIcon } from "@/components/icons";

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
    // StarterKit v3 bundles Link; configuring it here rather than adding
    // a second copy, which Tiptap warns about as a duplicate extension.
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Image,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-editor max-w-none min-h-[360px] focus:outline-none",
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
        // Uploads straight to object storage when it is configured, and
        // through this server otherwise. See lib/uploadClient.ts.
        const result = await uploadFile(file);
        if (!result.ok) {
          setUploadError(result.error);
          return;
        }
        editor.chain().focus().setImage({ src: result.media.url, alt: file.name }).run();
      } finally {
        setUploading(false);
      }
    },
    [editor]
  );

  if (!editor) {
    return <div className="card min-h-[420px] animate-pulse bg-surface-2/50" aria-hidden="true" />;
  }

  return (
    <div className="card overflow-hidden focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/10">
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
      {uploadError && (
        <p className="border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger" role="alert">
          {uploadError}
        </p>
      )}
      <div className="px-5 py-4 sm:px-8 sm:py-6">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  title,
  active,
  onClick,
  disabled,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium transition-colors disabled:opacity-50 ${
        active ? "bg-ink text-paper" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
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
  const chain = () => editor.chain().focus();

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-2/80 px-2 py-1.5 backdrop-blur">
      <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <span className="font-serif italic">I</span>
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton
        title="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        title="Subheading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        •
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </ToolbarButton>
      <ToolbarButton title="Pull quote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        <span className="font-serif text-lg leading-none">❝</span>
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton
        title="Link"
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) {
            chain().unsetLink().run();
            return;
          }
          const url = window.prompt("Link URL");
          if (url) chain().setLink({ href: url }).run();
        }}
      >
        <LinkIcon size={16} />
      </ToolbarButton>
      <ToolbarButton title="Insert image" onClick={onPickImage} disabled={uploading}>
        <ImageIcon size={16} />
        {uploading && <span className="ml-1 text-xs">Uploading…</span>}
      </ToolbarButton>
    </div>
  );
}
