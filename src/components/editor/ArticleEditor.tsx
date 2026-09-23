"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useRef, useState } from "react";
import { uploadFile, type UploadedMedia } from "@/lib/uploadClient";
import { AudioIcon, ImageIcon, LinkIcon, VideoIcon } from "@/components/icons";
import { MediaFigure, type MediaFigureAttrs, type MediaFigureKind } from "./MediaFigure";
import { MediaDetailsDialog, type MediaDetailsDone } from "./MediaDetailsDialog";

interface ArticleEditorProps {
  initialContent?: object | string;
  onChange: (json: object, html: string) => void;
}

/** What each toolbar button accepts. The server decides by magic bytes; this only filters the picker. */
const ACCEPT: Record<MediaFigureKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/flac",
};

const KIND_OF: Record<UploadedMedia["type"], MediaFigureKind> = { IMAGE: "image", VIDEO: "video", AUDIO: "audio" };

/**
 * The document as plain objects.
 *
 * ProseMirror builds every node's `attrs` with Object.create(null). React
 * will not serialise a null-prototype object into a Server Action call —
 * it sends a "temporary reference" instead, and the first thing on the
 * server to touch it (Prisma, storing bodyJson) dies with "Cannot access
 * toStringTag on the server". A paragraph has no attrs, so plain text
 * saved fine; a heading, an image or a figure did not. One round trip
 * through JSON gives every object the ordinary prototype.
 */
function plainJson(doc: object): object {
  return JSON.parse(JSON.stringify(doc)) as object;
}

/**
 * The details dialog is open for one of two reasons: a file was just
 * uploaded and is waiting to be inserted, or an existing figure is being
 * edited and its attributes updated in place.
 */
type DialogState =
  | { mode: "insert"; media: UploadedMedia }
  | { mode: "edit"; media: { id: string; type: UploadedMedia["type"]; url: string }; apply: (next: Partial<MediaFigureAttrs>) => void };

export function ArticleEditor({ initialContent, onChange }: ArticleEditorProps) {
  const [uploading, setUploading] = useState<MediaFigureKind | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickingRef = useRef<MediaFigureKind>("image");

  const editor = useEditor({
    // Required for Next.js App Router: without this, Tiptap renders once
    // on the server and once on the client and React flags a hydration
    // mismatch, since the editor's DOM is inherently client-driven.
    immediatelyRender: false,
    // StarterKit v3 bundles Link; configuring it here rather than adding
    // a second copy, which Tiptap warns about as a duplicate extension.
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      // Still registered so stories written before figures existed (a
      // bare <img>) load; new images go in as figures with a credit.
      Image,
      MediaFigure.configure({
        onEdit: (attrs, apply) => {
          const type = attrs.kind === "image" ? "IMAGE" : attrs.kind === "video" ? "VIDEO" : "AUDIO";
          setDialog({ mode: "edit", media: { id: attrs.mediaId, type, url: attrs.src }, apply });
        },
      }),
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
      onChange(plainJson(editor.getJSON()), editor.getHTML());
    },
    onUpdate: ({ editor }) => {
      onChange(plainJson(editor.getJSON()), editor.getHTML());
    },
  });

  const pick = useCallback((kind: MediaFigureKind) => {
    pickingRef.current = kind;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = ACCEPT[kind];
    input.click();
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!editor) return;
      setUploadError(null);
      setUploading(pickingRef.current);
      try {
        // Uploads straight to object storage when it is configured, and
        // through this server otherwise. See lib/uploadClient.ts.
        const result = await uploadFile(file);
        if (!result.ok) {
          setUploadError(result.error);
          return;
        }
        // Nothing goes into the story until its credit and licence are
        // recorded — see MediaDetailsDialog.
        setDialog({ mode: "insert", media: result.media });
      } finally {
        setUploading(null);
      }
    },
    [editor]
  );

  function finishDialog(values: MediaDetailsDone) {
    if (!dialog || !editor) return;
    if (dialog.mode === "insert") {
      editor
        .chain()
        .focus()
        .insertMediaFigure({
          kind: KIND_OF[dialog.media.type],
          src: dialog.media.url,
          mediaId: dialog.media.id,
          alt: values.altText,
          caption: values.caption,
          credit: values.creditLine,
        })
        .run();
    } else {
      dialog.apply({ alt: values.altText, caption: values.caption, credit: values.creditLine });
    }
    setDialog(null);
  }

  if (!editor) {
    return <div className="card min-h-[420px] animate-pulse bg-surface-2/50" aria-hidden="true" />;
  }

  return (
    <div className="card overflow-hidden focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/10">
      <Toolbar editor={editor} onPick={pick} uploading={uploading} />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT.image}
        hidden
        data-testid="editor-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
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
      {dialog && (
        <MediaDetailsDialog
          key={dialog.media.id}
          media={dialog.media}
          onDone={finishDialog}
          onCancel={() => setDialog(null)}
        />
      )}
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
  onPick,
  uploading,
}: {
  editor: Editor;
  onPick: (kind: MediaFigureKind) => void;
  uploading: MediaFigureKind | null;
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
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <ToolbarButton title="Insert image" onClick={() => onPick("image")} disabled={uploading !== null}>
        <ImageIcon size={16} />
        {uploading === "image" && <span className="ml-1 text-xs">Uploading…</span>}
      </ToolbarButton>
      <ToolbarButton title="Insert video" onClick={() => onPick("video")} disabled={uploading !== null}>
        <VideoIcon size={16} />
        {uploading === "video" && <span className="ml-1 text-xs">Uploading…</span>}
      </ToolbarButton>
      <ToolbarButton title="Insert audio" onClick={() => onPick("audio")} disabled={uploading !== null}>
        <AudioIcon size={16} />
        {uploading === "audio" && <span className="ml-1 text-xs">Uploading…</span>}
      </ToolbarButton>
    </div>
  );
}
