import { useEffect, useState } from "react";
import type { BoardConnection } from "../../lib/board.ts";
import { importImage, uploadImage } from "../../lib/media.ts";
import { requestExport } from "../../lib/exports.ts";
import { type Unfurl, unfurlLink } from "../../lib/links.ts";
import { api } from "../../lib/api.ts";
import {
  embedDefaultSize,
  embedHeightFor,
  embeddableUrl,
  extractIframeSrc,
} from "../../lib/embed.ts";
import type { Board, Element } from "../../types.ts";
import { toast } from "../kit/index.ts";
import { EMBED_CHOICE_KEY, URL_CHOICE_KEY } from "./constants.ts";
import {
  escapeText,
  htmlVisibleText,
  isImageUrl,
  loadImageSize,
  parseClipboardHtmlAll,
  siteName,
} from "./url.ts";
import { TOOL_SPECS } from "./tools.ts";
import { deserializeElements, parseMilanoteHtml } from "./clipboard.ts";
import { startPointerDrag } from "./drag.ts";
import { sanitizeHtml } from "../../lib/sanitize.ts";

type Pt = { x: number; y: number };
type Coords = { id: string; kind: "image" | "link" | "embed" | "board" };

// Everything that brings content INTO the board: the create tools (note/todo/column placeholders +
// press-and-drag placement), and all import flows — dropped/pasted files, URLs, images, embeds, and
// links, with the image-vs-link and link-vs-embed choice dialogs. Owns the dialog/choice state and
// the busy flag; selection, z, columns, and patch live in Canvas and are passed in.
export function useImport(deps: {
  connRef: React.RefObject<BoardConnection | null>;
  boardId: string;
  workspaceId: string;
  toWorld: (clientX: number, clientY: number) => Pt;
  viewportCentre: () => Pt;
  readOnly: boolean;
  editingId: string | null;
  nextZ: () => number;
  patch: (id: string, p: Partial<Element>) => void;
  selectNew: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setDraggingId: (id: string | null) => void;
  setColDrop: (v: { colId: string; index: number } | null) => void;
  columnDropAt: (
    clientX: number,
    clientY: number,
    excludeId?: string,
  ) => { colId: string; index: number } | null;
  moveChildToColumn: (childId: string, colId: string, index: number) => void;
  setMediaUrls: (
    fn: (m: Record<string, string>) => Record<string, string>,
  ) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  fillRef: React.MutableRefObject<Coords | null>;
  dropCoords: React.MutableRefObject<Pt | null>;
  // Paste a list of elements near (x,y) — fed elements parsed from the OS clipboard (a meko copy,
  // same app or another board/tab).
  pasteElements: (els: Element[], x: number, y: number) => void;
}) {
  const {
    connRef,
    boardId,
    workspaceId,
    toWorld,
    viewportCentre,
    readOnly,
    editingId,
    nextZ,
    patch,
    selectNew,
    setEditingId,
    setDraggingId,
    setColDrop,
    columnDropAt,
    moveChildToColumn,
    setMediaUrls,
    fileRef,
    fillRef,
    dropCoords,
    pasteElements,
  } = deps;

  const [busy, setBusy] = useState(false);
  const [linkModal, setLinkModal] = useState<Pt | null>(null);
  const [boardModal, setBoardModal] = useState<Pt | null>(null);
  const [embedModal, setEmbedModal] = useState<Pt | null>(null);
  const [urlChoice, setUrlChoice] = useState<{
    u: Unfurl;
    url: string;
    at: Pt;
  } | null>(null);
  const [embedChoice, setEmbedChoice] = useState<{
    url: string;
    embed: string;
    at: Pt;
  } | null>(null);

  const createNote = (x: number, y: number, text = "") => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "note",
      x,
      y,
      w: 220,
      h: 120,
      text,
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
    setEditingId(null);
  };

  const createTodo = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "todo",
      x,
      y,
      w: 240,
      h: 140,
      title: "",
      items: [{ id: crypto.randomUUID(), text: "", done: false }],
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
  };

  const createColumn = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "column",
      x,
      y,
      w: 280,
      h: 120,
      title: "",
      children: [],
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
  };

  // Press-and-drag from a tool: spawn the default/placeholder element under the cursor; it follows
  // until release. Input tools (image/link/embed/board) then open their dialog to fill the
  // placeholder (fillRef tells those flows to patch the placeholder rather than create new).
  const startPlace = (toolKey: string, e: React.PointerEvent) => {
    if (readOnly) return;
    const c = connRef.current;
    if (!c) return;
    const spec = TOOL_SPECS[toolKey];
    if (!spec) return;
    const id = crypto.randomUUID();
    const w0 = toWorld(e.clientX, e.clientY);
    const size = { w: spec.w, h: spec.h };
    const fill = spec.fill ?? null;
    c.elements.set(id, {
      ...spec.make({
        id,
        x: w0.x - spec.w / 2,
        y: w0.y - spec.h / 2,
        w: spec.w,
        h: spec.h,
      }),
      z: nextZ(),
    });
    selectNew(id);
    setDraggingId(id);
    const intoColumn = !!spec.nestable; // columns can't nest
    startPointerDrag({
      onMove: (ev) => {
        const w = toWorld(ev.clientX, ev.clientY);
        patch(id, { x: w.x - size.w / 2, y: w.y - size.h / 2 });
        setColDrop(intoColumn ? columnDropAt(ev.clientX, ev.clientY, id) : null);
      },
      onUp: (ev) => {
        setDraggingId(null);
        setColDrop(null);
        // Dropped onto a column → add as a child.
        if (intoColumn) {
          const drop = columnDropAt(ev.clientX, ev.clientY, id);
          if (drop) moveChildToColumn(id, drop.colId, drop.index);
        }
        if (!fill) return;
        fillRef.current = { id, kind: fill };
        if (fill === "image") fileRef.current?.click();
        else if (fill === "link") setLinkModal({ x: 0, y: 0 });
        else if (fill === "embed") setEmbedModal({ x: 0, y: 0 });
        else if (fill === "board") setBoardModal({ x: 0, y: 0 });
      },
      // Esc: abandon placement — remove the just-spawned placeholder.
      onCancel: () => {
        setDraggingId(null);
        setColDrop(null);
        connRef.current?.elements.delete(id);
      },
    });
  };
  // Remove an unfilled placeholder when its fill dialog is dismissed.
  const cancelFill = (kind: "image" | "link" | "embed" | "board") => {
    if (fillRef.current?.kind === kind) {
      connRef.current?.elements.delete(fillRef.current.id);
      fillRef.current = null;
    }
  };

  // Create a new board in this workspace and drop a tile that opens it (nested boards). When filling
  // a placeholder (drag-placed Board tool), patch that element instead of creating a new tile.
  const createBoardElement = async (title: string) => {
    const c = connRef.current;
    const at = boardModal ?? viewportCentre();
    const target =
      fillRef.current?.kind === "board" ? fillRef.current.id : null;
    fillRef.current = null;
    if (!c) return;
    try {
      const b = await api<Board>(`/api/workspaces/${workspaceId}/boards`, {
        method: "POST",
        body: JSON.stringify({ title, parentBoardId: boardId }),
      });
      if (target) {
        const cur = c.elements.get(target);
        if (cur?.type === "board")
          patch(target, { boardId: b.id, title: b.title } as Partial<Element>);
      } else {
        const id = crypto.randomUUID();
        c.elements.set(id, {
          id,
          type: "board",
          x: at.x,
          y: at.y,
          w: 200,
          h: 116,
          boardId: b.id,
          title: b.title,
          style: { fill: "#ffffff" },
          z: nextZ(),
        });
        selectNew(id);
      }
    } catch {
      toast("Couldn't create board", "error");
      if (target) c.elements.delete(target);
    }
  };

  // Drop an embed element with a resolved iframe src.
  const dropEmbed = (src: string, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const { w, h } = embedDefaultSize(src);
    c.elements.set(id, { id, type: "embed", x, y, w, h, src, z: nextZ() });
    selectNew(id);
  };
  // Embed tool: raw embed code only — paste an <iframe …> snippet.
  const createEmbed = (input: string) => {
    const at = embedModal ?? viewportCentre();
    const target =
      fillRef.current?.kind === "embed" ? fillRef.current.id : null;
    fillRef.current = null;
    const src = extractIframeSrc(input);
    if (!src) {
      toast("Paste embed code (an <iframe> snippet)", "error");
      if (target) connRef.current?.elements.delete(target);
      return;
    }
    if (target) {
      const cur = connRef.current?.elements.get(target);
      if (cur?.type === "embed")
        patch(target, {
          src,
          h: embedHeightFor(src, cur.w),
        } as Partial<Element>);
    } else dropEmbed(src, at.x, at.y);
  };

  // Drop a link preview card from an already-fetched unfurl.
  const dropLink = (u: Unfurl, url: string, at: Pt, embedSrc?: string) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const w = embedSrc ? 360 : 260;
    const previewH = embedSrc
      ? embedHeightFor(embedSrc, w)
      : u.imageUrl
        ? 230
        : 0;
    c.elements.set(id, {
      id,
      type: "link",
      x: at.x,
      y: at.y,
      w,
      h: previewH + 96,
      url: u.url || url,
      title: u.title ?? undefined,
      description: u.description ?? undefined,
      image: u.imageUrl ?? undefined,
      embedSrc,
      z: nextZ(),
    });
    selectNew(id);
  };

  // Unfurl + drop a link card at a point; returns an approximate height for column stacking.
  const makeLinkAt = async (
    url: string,
    x: number,
    y: number,
  ): Promise<number> => {
    try {
      const u = await unfurlLink(boardId, url);
      dropLink(u, url, { x, y });
      return u.imageUrl ? 230 : 120;
    } catch {
      dropLink({ url, title: null, description: null, imageUrl: null }, url, {
        x,
        y,
      });
      return 120;
    }
  };

  // Place creators in a vertical column (Milanote-style); each returns its height to stack the next.
  const pasteColumn = async (
    makers: Array<(x: number, y: number) => Promise<number> | number>,
    start?: Pt,
  ) => {
    const at = start ?? viewportCentre();
    let py = at.y;
    for (const make of makers) {
      const h = await make(at.x, py);
      py += (h || 160) + 16;
    }
  };

  const addImageFile = async (
    file: File,
    x: number,
    y: number,
  ): Promise<number> => {
    const c = connRef.current;
    if (!c) return 0;
    setBusy(true);
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const { w, h } = await loadImageSize(displayUrl);
      const id = crypto.randomUUID();
      const width = 280;
      const height = Math.max(40, Math.round((width * h) / w));
      c.elements.set(id, {
        id,
        type: "image",
        x,
        y,
        w: width,
        h: height,
        src: displayUrl,
        mediaId,
        alt: file.name,
        z: nextZ(),
      });
      selectNew(id);
      toast("Image added", "success");
      return height;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
      return 0;
    } finally {
      setBusy(false);
    }
  };

  // Image element from an external URL (no upload) — used for image URLs dropped/pasted in. When
  // it came from a web page, attribute the source as a "from {site}" caption.
  const createImageUrl = async (
    src: string,
    x: number,
    y: number,
    sourceUrl?: string,
  ): Promise<number> => {
    const c = connRef.current;
    if (!c) return 0;
    const { w, h } = await loadImageSize(src);
    const width = 280;
    const id = crypto.randomUUID();
    const height = Math.max(40, Math.round((width * h) / w));
    const caption = sourceUrl
      ? `From <a href="${sourceUrl}">${escapeText(`${siteName(sourceUrl)}`)}</a>`
      : undefined;
    c.elements.set(id, {
      id,
      type: "image",
      x,
      y,
      w: width,
      h: height,
      src,
      z: nextZ(),
      ...(caption ? { caption, showCaption: true } : {}),
    });
    selectNew(id);
    return height + (caption ? 40 : 0);
  };

  // Recreate a copied Milanote selection at high fidelity: its image cards (with captions) and text
  // cards become meko images/notes, wrapped in a column (titled when Milanote gave one) so the
  // grouping is preserved. External HTML is sanitised before it touches the board.
  const importMilanote = async (
    mn: NonNullable<ReturnType<typeof parseMilanoteHtml>>,
    at: Pt,
  ) => {
    const c = connRef.current;
    if (!c) return;
    const built: Element[] = [];
    const imageSrcById: { id: string; src: string }[] = [];
    for (const it of mn.items) {
      const id = crypto.randomUUID();
      if (it.kind === "image") {
        const { w, h } = await loadImageSize(it.src);
        const width = 280;
        const height = Math.max(40, Math.round((width * h) / w));
        const caption = it.caption ? sanitizeHtml(it.caption) : undefined;
        imageSrcById.push({ id, src: it.src });
        built.push({
          id,
          type: "image",
          x: at.x,
          y: at.y,
          w: width,
          h: height,
          src: it.src, // external URL; swapped to a meko mediaId once imported (below)
          ...(caption ? { caption, showCaption: true } : {}),
        } as Element);
      } else if (it.kind === "todo") {
        built.push({
          id,
          type: "todo",
          x: at.x,
          y: at.y,
          w: 240,
          h: 140,
          title: it.title ?? "",
          items: it.items.map((t) => ({
            id: crypto.randomUUID(),
            text: t.text,
            done: t.done,
          })),
          style: { fill: "#ffffff" },
        } as Element);
      } else if (it.kind === "link") {
        const w = it.embedSrc ? 360 : 260;
        const previewH = it.embedSrc ? embedHeightFor(it.embedSrc, w) : 0;
        built.push({
          id,
          type: "link",
          x: at.x,
          y: at.y,
          w,
          h: previewH + 96,
          url: it.url,
          ...(it.title ? { title: it.title } : {}),
          ...(it.embedSrc ? { embedSrc: it.embedSrc } : {}),
        } as Element);
      } else {
        built.push({
          id,
          type: "note",
          x: at.x,
          y: at.y,
          w: 220,
          h: 120,
          text: sanitizeHtml(it.html),
          style: { fill: "#ffffff" },
        } as Element);
      }
    }
    if (!built.length || !connRef.current) return;
    // Wrap in a column when Milanote gave a column (title) or there are several cards.
    const wrap = mn.title !== null || built.length > 1;
    const colId = wrap ? crypto.randomUUID() : null;
    c.doc.transact(() => {
      let z = nextZ();
      for (const ch of built) c.elements.set(ch.id, { ...ch, z: z++ } as Element);
      if (colId)
        c.elements.set(colId, {
          id: colId,
          type: "column",
          x: at.x,
          y: at.y,
          w: 280,
          h: 120,
          title: mn.title ?? "",
          children: built.map((b) => b.id),
          style: { fill: "#ffffff" },
          z: z++,
        });
    });
    selectNew(colId ?? built[0]!.id);

    // Copy the (external) images into meko storage in the background so the paste appears instantly;
    // swap each element to its meko mediaId once stored (display derivative resolves via the media
    // effect). On failure the element keeps its external URL.
    for (const { id, src } of imageSrcById)
      importImage(boardId, src)
        .then((mediaId) => patch(id, { mediaId } as Partial<Element>))
        .catch(() => {});
  };

  // Build element creators from clipboard/drop data and lay them out in a column. Handles multiple
  // items (image files, or an HTML payload with several images/links/embeds). Returns true if handled.
  const dropClipboard = (
    files: File[],
    text: string,
    html: string,
    start?: Pt,
  ): boolean => {
    const makers: Array<(x: number, y: number) => Promise<number> | number> =
      [];
    for (const f of files) makers.push((x, y) => addImageFile(f, x, y));
    if (!files.length) {
      // A copied Milanote selection: rebuild its cards (images + notes) as a meko column.
      const mn = parseMilanoteHtml(html);
      if (mn) {
        void importMilanote(mn, start ?? viewportCentre());
        return true;
      }
      const iframeSrc = extractIframeSrc(text);
      const isUrl = (l: string) => /^https?:\/\/\S+$/i.test(l);
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const urlLines = lines.filter(isUrl);
      if (iframeSrc) {
        makers.push((x, y) => {
          dropEmbed(iframeSrc, x, y);
          return embedHeightFor(iframeSrc, 360);
        });
      } else if (lines.length === 1 && urlLines.length === 1) {
        const at = start ?? viewportCentre();
        void handleUrl(lines[0]!, at.x, at.y); // single URL — may prompt image/link or embed
        return true;
      } else if (urlLines.length) {
        // Multiple text/plain lines with URLs (e.g. a copied Milanote column): one media element per
        // URL line, plus a single note for the remaining non-URL text.
        for (const l of lines) {
          if (isUrl(l))
            makers.push((x, y) =>
              isImageUrl(l) ? createImageUrl(l, x, y) : makeLinkAt(l, x, y),
            );
        }
        const noteText = lines.filter((l) => !isUrl(l)).join("\n").trim();
        if (noteText)
          makers.push((x, y) => {
            createNote(x, y, noteText.slice(0, 10000));
            return 140;
          });
      } else {
        // No URLs in text/plain: take media from the HTML payload, else drop a plain note.
        const items = parseClipboardHtmlAll(html);
        if (items.length) {
          for (const it of items) {
            if (it.kind === "iframe")
              makers.push((x, y) => {
                dropEmbed(it.value, x, y);
                return embedHeightFor(it.value, 360);
              });
            else if (it.kind === "img")
              makers.push((x, y) => createImageUrl(it.value, x, y));
            else makers.push((x, y) => makeLinkAt(it.value, x, y));
          }
        } else if (text) {
          makers.push((x, y) => {
            createNote(x, y, text.slice(0, 10000));
            return 140;
          });
        }
      }
    } else {
      // Images plus accompanying note text (the text often lives in the HTML, not text/plain).
      const noteText = text || htmlVisibleText(html);
      if (noteText && !/^https?:\/\//i.test(noteText.split(/\s+/)[0] ?? "")) {
        makers.push((x, y) => {
          createNote(x, y, noteText.slice(0, 10000));
          return 140;
        });
      }
    }
    if (!makers.length) return false;
    void pasteColumn(makers, start);
    return true;
  };

  const pickImageAt = (x: number, y: number) => {
    dropCoords.current = { x, y };
    fileRef.current?.click();
  };

  // Manual "Add link" dialog: always a link card (unfurled).
  const createLink = async (url: string, coords?: Pt) => {
    const at = coords ?? linkModal ?? viewportCentre();
    const target = fillRef.current?.kind === "link" ? fillRef.current.id : null;
    fillRef.current = null;
    try {
      const u = await unfurlLink(boardId, url);
      if (target) {
        const cur = connRef.current?.elements.get(target);
        if (cur?.type === "link")
          patch(target, {
            url: u.url || url,
            title: u.title ?? undefined,
            description: u.description ?? undefined,
            image: u.imageUrl ?? undefined,
          } as Partial<Element>);
      } else dropLink(u, url, at);
    } catch {
      toast("Couldn't load that link", "error");
      if (target) connRef.current?.elements.delete(target);
    }
  };

  // Dropped/pasted URL: an image URL becomes an image; otherwise unfurl, and if the page has a
  // preview image the result is ambiguous (image vs link) — prompt, honouring a remembered choice.
  const handleUrl = async (url: string, x: number, y: number) => {
    if (isImageUrl(url)) return void createImageUrl(url, x, y);
    // Known embeddable providers: link-with-preview or a bare embed — prompt, honouring a choice.
    const embed = embeddableUrl(url);
    if (embed) {
      const remembered = localStorage.getItem(EMBED_CHOICE_KEY);
      if (remembered === "embed") return dropEmbed(embed, x, y);
      if (remembered === "link")
        return void createProviderLink(url, embed, { x, y });
      setEmbedChoice({ url, embed, at: { x, y } });
      return;
    }
    const at = { x, y };
    let u: Unfurl;
    try {
      u = await unfurlLink(boardId, url);
    } catch {
      toast("Couldn't load that link", "error");
      return;
    }
    if (!u.imageUrl) return dropLink(u, url, at); // nothing to choose between
    const remembered = localStorage.getItem(URL_CHOICE_KEY);
    if (remembered === "image")
      return void createImageUrl(u.imageUrl, at.x, at.y, url);
    if (remembered === "link") return dropLink(u, url, at);
    setUrlChoice({ u, url, at });
  };

  const applyUrlChoice = (kind: "image" | "link", remember: boolean) => {
    const choice = urlChoice;
    setUrlChoice(null);
    if (!choice) return;
    if (remember) localStorage.setItem(URL_CHOICE_KEY, kind);
    if (kind === "image" && choice.u.imageUrl)
      void createImageUrl(
        choice.u.imageUrl,
        choice.at.x,
        choice.at.y,
        choice.url,
      );
    else dropLink(choice.u, choice.url, choice.at);
  };

  // Provider link: unfurl for the title (track/video name), then a link card with the live embed
  // as its preview. Falls back to a bare card if the unfurl fails.
  const createProviderLink = async (url: string, embed: string, at: Pt) => {
    let u: Unfurl = { url, title: null, description: null, imageUrl: null };
    try {
      u = await unfurlLink(boardId, url);
    } catch {
      /* keep fallback */
    }
    dropLink(u, url, at, embed);
  };

  const applyEmbedChoice = (kind: "link" | "embed", remember: boolean) => {
    const choice = embedChoice;
    setEmbedChoice(null);
    if (!choice) return;
    if (remember) localStorage.setItem(EMBED_CHOICE_KEY, kind);
    if (kind === "embed") dropEmbed(choice.embed, choice.at.x, choice.at.y);
    else void createProviderLink(choice.url, choice.embed, choice.at);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target =
      fillRef.current?.kind === "image" ? fillRef.current.id : null;
    fillRef.current = null;
    if (!file) {
      if (target) connRef.current?.elements.delete(target); // picker canceled → drop placeholder
      return;
    }
    if (target) {
      setBusy(true);
      try {
        const { mediaId, displayUrl } = await uploadImage(boardId, file);
        setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
        const { w, h } = await loadImageSize(displayUrl);
        const cur = connRef.current?.elements.get(target);
        if (cur?.type === "image")
          patch(target, {
            src: displayUrl,
            mediaId,
            alt: file.name,
            h: Math.max(40, Math.round((cur.w * h) / w)),
          } as Partial<Element>);
        toast("Image added", "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed", "error");
        connRef.current?.elements.delete(target);
      } finally {
        setBusy(false);
      }
      return;
    }
    const at = dropCoords.current ?? viewportCentre();
    await addImageFile(file, at.x, at.y);
  };

  const onExport = async () => {
    setBusy(true);
    toast("Preparing export…");
    try {
      window.open(await requestExport(boardId, "png"), "_blank");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };

  // The whole canvas is a drop zone: internal tools, image files, URLs, or plain text. Read the
  // dataTransfer synchronously (it's cleared after the first await).
  const onDrop = (e: React.DragEvent): boolean => {
    if (readOnly) return false;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const uri = (
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain")
    ).trim();
    const html = e.dataTransfer.getData("text/html");
    return dropClipboard(files, uri, html, { x, y });
  };

  // Paste anywhere on the board: an image from the clipboard uploads; an image URL becomes an
  // image; another URL becomes a link; other text becomes a note. Skipped while editing a note so
  // normal text paste works.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        editingId ||
        (ae &&
          (ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.isContentEditable))
      )
        return;
      const dt = e.clipboardData;
      if (!dt) return;
      // A meko element copy (same app, or another board/tab) rides on the OS clipboard as a text/html
      // marker. The OS clipboard is the single source of truth, so an external copy — which replaces
      // the clipboard — naturally wins over a previously-copied meko element.
      const meko = deserializeElements(dt.getData("text/html"));
      if (meko) {
        const at = viewportCentre();
        pasteElements(meko, at.x, at.y);
        e.preventDefault();
        return;
      }
      // Read all image files synchronously (clipboard items expire after the event).
      const files = Array.from(dt.items)
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      const text = dt.getData("text").trim();
      const html = dt.getData("text/html");
      if (dropClipboard(files, text, html)) e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, readOnly]);

  return {
    busy,
    // dialog / choice state
    linkModal,
    setLinkModal,
    boardModal,
    setBoardModal,
    embedModal,
    setEmbedModal,
    urlChoice,
    setUrlChoice,
    embedChoice,
    setEmbedChoice,
    // element creators
    createNote,
    createTodo,
    createColumn,
    // tools + import
    startPlace,
    cancelFill,
    pickImageAt,
    createBoardElement,
    createEmbed,
    createLink,
    applyUrlChoice,
    applyEmbedChoice,
    onPickImage,
    onExport,
    onDrop,
  };
}
