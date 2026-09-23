"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { PenIcon, TrashIcon } from "@/components/icons";

/**
 * A picture, video or audio clip in the story, as one block.
 *
 * Rendered to HTML as a <figure data-media-id data-kind> holding the
 * media element and a <figcaption> with the caption and credit — which
 * is what lib/sanitize.ts allows and what the public page styles. The
 * data-media-id ties the block to its Media row, so the credits list, the
 * audio player and the publish gate all know which file it is.
 *
 * Details (caption, credit, licence, transcript) are edited in a dialog
 * rather than inline: the licence and the rights confirmation are stored
 * on the Media row, not in the document, and one form for all of it is
 * harder to half-fill than a caption box and a separate settings page.
 */
export type MediaFigureKind = "image" | "video" | "audio";

export interface MediaFigureAttrs {
  kind: MediaFigureKind;
  src: string;
  mediaId: string;
  alt: string | null;
  caption: string | null;
  credit: string | null;
}

export interface MediaFigureOptions {
  /** Opens the details dialog for a figure already in the document. */
  onEdit: (attrs: MediaFigureAttrs, apply: (next: Partial<MediaFigureAttrs>) => void) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaFigure: {
      insertMediaFigure: (attrs: MediaFigureAttrs) => ReturnType;
    };
  }
}

function captionText(attrs: Pick<MediaFigureAttrs, "caption" | "credit">): string | null {
  const parts = [attrs.caption?.trim(), attrs.credit?.trim()].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

export const MediaFigure = Node.create<MediaFigureOptions>({
  name: "mediaFigure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { onEdit: () => {} };
  },

  addAttributes() {
    return {
      kind: { default: "image" },
      src: { default: "" },
      mediaId: { default: "" },
      alt: { default: null },
      caption: { default: null },
      credit: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-media-id]",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const media = el.querySelector("img, video, audio");
          if (!media) return false;
          const kind = (el.dataset.kind as MediaFigureKind | undefined) ?? (media.tagName.toLowerCase() as MediaFigureKind);
          const captionEl = el.querySelector("figcaption");
          // The figcaption is "caption — credit"; split on the em dash the
          // renderer put there. A caption containing one itself survives
          // as caption text, since only the last dash is treated as the
          // separator.
          const text = captionEl?.textContent?.trim() ?? "";
          const dash = text.lastIndexOf(" — ");
          return {
            kind,
            src: media.getAttribute("src") ?? "",
            mediaId: el.dataset.mediaId ?? "",
            alt: media.getAttribute("alt"),
            caption: dash >= 0 ? text.slice(0, dash) : text || null,
            credit: dash >= 0 ? text.slice(dash + 3) : null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as unknown as MediaFigureAttrs;
    const figureAttrs = mergeAttributes({ "data-media-id": attrs.mediaId, "data-kind": attrs.kind, class: "media-figure" });
    const media =
      attrs.kind === "image"
        ? ["img", { src: attrs.src, alt: attrs.alt ?? "" }]
        : attrs.kind === "video"
          ? ["video", { src: attrs.src, controls: "controls", preload: "metadata", playsinline: "playsinline" }]
          : ["audio", { src: attrs.src, controls: "controls", preload: "metadata" }];
    const caption = captionText(attrs);
    return caption ? ["figure", figureAttrs, media, ["figcaption", {}, caption]] : ["figure", figureAttrs, media];
  },

  addCommands() {
    return {
      insertMediaFigure:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaFigureView);
  },
});

function MediaFigureView({ node, updateAttributes, deleteNode, extension, selected }: NodeViewProps) {
  const attrs = node.attrs as MediaFigureAttrs;
  const options = extension.options as MediaFigureOptions;
  const caption = captionText(attrs);

  return (
    <NodeViewWrapper
      as="figure"
      data-kind={attrs.kind}
      className={`media-figure group relative my-6 rounded-lg border ${selected ? "border-ink ring-2 ring-ink/10" : "border-transparent"}`}
    >
      {attrs.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- just uploaded through this site's own pipeline
        <img src={attrs.src} alt={attrs.alt ?? ""} className="w-full rounded-lg bg-surface-2" draggable={false} />
      )}
      {attrs.kind === "video" && (
        <video src={attrs.src} controls preload="metadata" playsInline className="w-full rounded-lg bg-black" />
      )}
      {attrs.kind === "audio" && (
        <div className="rounded-lg bg-surface-2 p-3">
          <audio src={attrs.src} controls preload="metadata" className="w-full" />
        </div>
      )}
      <figcaption className={`mt-2 text-xs ${caption ? "text-ink-3" : "text-danger"}`}>
        {caption ?? "No caption or credit yet — open Details."}
      </figcaption>
      <div
        className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        contentEditable={false}
      >
        <button
          type="button"
          className="btn btn-sm bg-paper/95 text-ink shadow-card backdrop-blur"
          onClick={() => options.onEdit(attrs, (next) => updateAttributes(next))}
        >
          <PenIcon size={13} /> Details
        </button>
        <button type="button" className="btn btn-sm bg-paper/95 text-danger shadow-card backdrop-blur" onClick={() => deleteNode()} title="Remove">
          <TrashIcon size={13} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}
