"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { createP2pProvider, type P2pProvider } from "@/lib/p2pProvider";
import { useEditor, EditorContent } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { baseExtensions } from "@html-editor/editor-schema";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDocumentQueryKey,
  useCreateDocument,
  useGetDocument,
  useUpdateDocument,
} from "@/api/generated/endpoints";
import { History, ListTree, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HistorySheet } from "@/components/HistorySheet";
import { Input } from "@/components/ui/input";
import { Toolbar } from "@/components/Toolbar";
import { PresenceAvatars, type AwarenessUser } from "@/components/PresenceAvatars";
import { AiConnectModal } from "@/components/AiConnectModal";
import { SelectionMenu } from "@/components/SelectionMenu";
import { ShareMenu } from "@/components/ShareMenu";
import { FileMenu } from "@/components/FileMenu";
import { MarginCommentDraft } from "@/components/MarginCommentDraft";
import { DocumentOutline } from "@/components/DocumentOutline";
import { useDocumentStructure } from "@/lib/useDocumentStructure";
import { usePanelPreference } from "@/lib/usePanelPreference";
import {
  CommentsMargin,
  type MarginCommentInfo,
} from "@/components/MarginCommentCard";
import {
  composeFullDocument,
  detectPaperLayout,
  extractStyles,
  parseBodyAttrs,
  scopeCss,
  stripComments,
} from "@/lib/docStyles";
import { updateLocalDocTitle } from "@/lib/localDocs";

const USER_COLORS = [
  "#d93025",
  "#e37400",
  "#188038",
  "#1a73e8",
  "#9334e6",
  "#e52592",
  "#007b83",
  "#b06000",
  "#5b3fd4",
  "#0b8043",
  "#c2185b",
  "#8d6e63",
];

const USER_STORAGE_KEY = "html-docs-user";

// Each user has a color tied to their identity: derived
// deterministically from the name, so the same name always gets the
// same color in any browser, and different names (almost always) differ.
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function loadUser(): AwarenessUser {
  let name = "";
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AwarenessUser>;
      name = parsed.name?.trim() ?? "";
    }
  } catch {
    // ignore corrupted storage and generate a new user
  }
  if (!name) name = `Guest ${Math.floor(Math.random() * 90) + 10}`;
  const user: AwarenessUser = { name, color: colorForName(name) };
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  return user;
}

interface CollabSession {
  ydoc: Y.Doc;
  provider: P2pProvider;
}

// Custom cursor renderer: exposes the user's identity color as a CSS
// variable so the name badge can be styled as liquid glass in CSS
// (translucent color tint + blur) instead of a solid inline background.
function renderCollaborationCursor(user: Record<string, string>) {
  const cursor = document.createElement("span");
  cursor.classList.add("collaboration-cursor__caret");
  cursor.style.setProperty("border-color", user.color);
  cursor.style.setProperty("--user-color", user.color);
  const label = document.createElement("div");
  label.classList.add("collaboration-cursor__label");
  label.textContent = user.name;
  cursor.appendChild(label);
  return cursor;
}

// Creates the Y.Doc and provider inside a useEffect: survives React
// StrictMode's mount → unmount → remount cycle (a useMemo destroyed in
// cleanup would never be recreated, leaving a dead connection and sync
// relying only on sporadic reconnects).
export function CollaborativeEditor({
  id,
  editKey: editKeyProp,
}: {
  id: string;
  editKey: string | null;
}) {
  const [session, setSession] = useState<CollabSession | null>(null);
  // Edit capability comes from the URL path (/doc/<id>/<key>); legacy
  // ?key= links keep working via the searchParams fallback. Without it
  // the server marks the connection read-only.
  const legacyKey = useSearchParams().get("key");
  const editKey = editKeyProp ?? legacyKey;

  useEffect(() => {
    const ydoc = new Y.Doc();
    // Offline-first: the document also lives in IndexedDB. It loads
    // instantly from local storage, keeps accepting edits while
    // offline, and the CRDT merges everything on reconnection.
    const persistence = new IndexeddbPersistence(`html-docs-${id}`, ydoc);
    let provider: P2pProvider | null = null;
    let disposed = false;

    void createP2pProvider({ docId: id, editKey, ydoc }).then((p2p) => {
      if (disposed) {
        p2p.destroy();
        return;
      }
      provider = p2p;
      setSession({ ydoc, provider: p2p });
    });

    return () => {
      disposed = true;
      provider?.destroy();
      persistence.destroy();
      ydoc.destroy();
      setSession(null);
    };
  }, [id, editKey]);

  if (!session) {
    return <div className="editor-loading">Connecting…</div>;
  }
  return <EditorSession id={id} editKey={editKey} session={session} />;
}

function EditorSession({
  id,
  editKey,
  session,
}: {
  id: string;
  editKey: string | null;
  session: CollabSession;
}) {
  const { ydoc, provider } = session;
  const router = useRouter();
  // Without the edit key the server enforces read-only; the UI mirrors
  // that: no toolbar, no comment actions, no typing.
  const viewMode = !editKey;
  const [user, setUser] = useState<AwarenessUser>(loadUser);
  const [status, setStatus] = useState<string>("connecting");
  const [users, setUsers] = useState<AwarenessUser[]>([]);
  const [title, setTitle] = useState<string>("");
  const [showAiConnect, setShowAiConnect] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "loading" | "error">("idle");
  // Version history: sheet visibility, the version being previewed in
  // place of the live document, and the restore confirmation dialog
  const [showHistory, setShowHistory] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{
    at: number;
    html: string;
  } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const previewGuardCleanup = useRef<(() => void) | null>(null);
  // Comment composer in the right margin: vertical position + open flag
  // (the ref lets BubbleMenu's shouldShow read fresh state without
  // re-creating the plugin)
  const [commentDraftTop, setCommentDraftTop] = useState<number | null>(null);
  const draftOpenRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Every comment in the document, always visible in the right margin
  const [comments, setComments] = useState<MarginCommentInfo[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  const { data: docResponse } = useGetDocument(id);
  // Offline fallback: document metadata (title, original head CSS, body
  // attributes) is cached locally on every successful fetch and reused
  // when the API is unreachable
  const doc = useMemo(() => {
    const fresh = docResponse?.data;
    const cacheKey = `html-docs-meta-${id}`;
    if (fresh) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(fresh));
      } catch {
        // storage full/unavailable: metadata cache is best-effort
      }
      return fresh;
    }
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached
        ? (JSON.parse(cached) as NonNullable<typeof docResponse>["data"])
        : undefined;
    } catch {
      return undefined;
    }
  }, [docResponse, id]);
  const updateDocument = useUpdateDocument();
  const queryClient = useQueryClient();

  // Original document CSS, scoped to the editor sheet only
  const docCss = useMemo(() => {
    if (!doc?.headHtml) return "";
    const { css } = extractStyles(doc.headHtml);
    return css ? scopeCss(css, ".doc-sheet") : "";
  }, [doc?.headHtml]);

  // Uploaded documents: decide between the A4-ish paper sheet
  // (print-like documents) and the full canvas (viewport layouts with
  // sidebars, grids, full-bleed backgrounds) from the document's own
  // CSS and structure.
  const paperLayout = useMemo(() => {
    if (!doc?.headHtml) return true;
    const { css } = extractStyles(doc.headHtml);
    return detectPaperLayout({ css, bodyHtml: doc.html ?? "" });
  }, [doc?.headHtml, doc?.html]);

  const bodyAttrs = useMemo(() => parseBodyAttrs(doc?.bodyAttrs), [doc?.bodyAttrs]);

  // External stylesheets (<link rel="stylesheet">, e.g. Google Fonts)
  useEffect(() => {
    if (!doc?.headHtml) return;
    const { stylesheetLinks } = extractStyles(doc.headHtml);
    const elements = stylesheetLinks.map((href) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    return () => elements.forEach((el) => el.remove());
  }, [doc?.headHtml]);

  useEffect(() => {
    if (doc && title === "") setTitle(doc.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);


  // Connection status (does not destroy the provider here — its
  // lifecycle belongs to the parent component)
  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setStatus(status);
    provider.on("status", onStatus);
    return () => {
      provider.off("status", onStatus);
    };
  }, [provider]);

  // List of connected users (Yjs awareness)
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const states = Array.from(
        awareness.getStates().values()
      ) as Array<Record<string, unknown>>;
      setUsers(
        states
          .map((state) => state.user as AwarenessUser | undefined)
          .filter((u): u is AwarenessUser => Boolean(u))
      );
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [provider]);

  const editor = useEditor(
    {
      extensions: [
        ...baseExtensions,
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user,
          render: renderCollaborationCursor,
        }),
      ],
      editable: !viewMode,
      immediatelyRender: false,
      editorProps: {
        attributes: { class: "doc-content" },
      },
    },
    [provider]
  );

  // Outline: read from whichever document is on screen — the version
  // snapshot while previewing, the live editor otherwise. Opens by
  // default only when there is something to navigate.
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null);
  // Stable callback (an inline one re-runs with null/el on every render,
  // which would churn previewEl): exposes the snapshot element and guards
  // it — the first actual edit is blocked and raises the restore question
  const previewRef = useCallback(
    (el: HTMLDivElement | null) => {
      setPreviewEl(el);
      // Detach a previous listener when the node changes/unmounts
      previewGuardCleanup.current?.();
      previewGuardCleanup.current = null;
      if (!el || viewMode) return;
      const onBeforeInput = (event: Event) => {
        event.preventDefault();
        setConfirmRestore(true);
      };
      el.addEventListener("beforeinput", onBeforeInput);
      previewGuardCleanup.current = () =>
        el.removeEventListener("beforeinput", onBeforeInput);
    },
    [viewMode]
  );
  const { headings } = useDocumentStructure(
    previewVersion ? previewEl : (editor?.view.dom ?? null)
  );
  const outline = usePanelPreference("outline", headings.length >= 2);

  // Ctrl/Cmd+Shift+O toggles the outline (as in VS Code). The ref keeps
  // one listener for the session while always calling the fresh toggle.
  const toggleOutlineRef = useRef(outline.toggle);
  useEffect(() => {
    toggleOutlineRef.current = outline.toggle;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        toggleOutlineRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The field may stay empty while the user types; the "Anonymous"
  // fallback only applies to what others see (awareness) and is written
  // back to the field only when leaving it empty.
  // Collects every comment in the document (first position of each id)
  // and where the caret currently is, on any local or remote change
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (!canvasRef.current) return;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const seen = new Set<string>();
      const found: MarginCommentInfo[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const mark of node.marks) {
          if (mark.type.name !== "comment") continue;
          const id = mark.attrs["data-comment-id"] as string | null;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const coords = editor.view.coordsAtPos(pos);
          found.push({
            id,
            top: coords.top - canvasRect.top,
            attrs: mark.attrs as Record<string, string | null>,
          });
        }
      });
      found.sort((a, b) => a.top - b.top || a.id.localeCompare(b.id));
      setComments(found);
      const attrs = editor.isActive("comment")
        ? editor.getAttributes("comment")
        : null;
      setActiveCommentId((attrs?.["data-comment-id"] as string) ?? null);
    };
    editor.on("transaction", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  // Removes a specific comment id across all its (possibly fragmented
  // or overlapping) ranges
  // Updates a comment's text across all its (possibly fragmented or
  // overlapping) ranges, preserving id, author and creation date
  const updateCommentText = (id: string, text: string) => {
    if (!editor) return;
    const markType = editor.state.schema.marks.comment;
    const { tr } = editor.state;
    // Computed once from the first fragment (all fragments of a comment
    // share the same attributes) so history is appended exactly once
    let newAttrs: Record<string, string | null> | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === markType && mark.attrs["data-comment-id"] === id) {
          if (!newAttrs) {
            const attrs = mark.attrs as Record<string, string | null>;
            if ((attrs["data-comment-text"] ?? "") === text) return;
            // The version being replaced joins the history, attributed
            // to whoever wrote it (the last editor, or the author)
            let history: { author: string; text: string; at: string }[] = [];
            try {
              history = JSON.parse(attrs["data-comment-history"] ?? "[]");
            } catch {
              history = [];
            }
            history.push({
              author:
                attrs["data-comment-edited-by"] ||
                attrs["data-comment-author"] ||
                "Anonymous",
              text: attrs["data-comment-text"] ?? "",
              at:
                attrs["data-comment-edited-at"] ||
                attrs["data-comment-created-at"] ||
                "",
            });
            newAttrs = {
              ...attrs,
              "data-comment-text": text,
              "data-comment-history": JSON.stringify(history),
              "data-comment-edited-by": user.name || "Anonymous",
              "data-comment-edited-at": new Date().toISOString(),
            };
          }
          const updated = markType.create(newAttrs);
          tr.removeMark(pos, pos + node.nodeSize, mark);
          tr.addMark(pos, pos + node.nodeSize, updated);
        }
      }
    });
    if (newAttrs) editor.view.dispatch(tr);
  };

  const removeCommentById = (id: string) => {
    if (!editor) return;
    const markType = editor.state.schema.marks.comment;
    const { tr } = editor.state;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === markType && mark.attrs["data-comment-id"] === id) {
          tr.removeMark(pos, pos + node.nodeSize, mark);
        }
      }
    });
    editor.view.dispatch(tr);
  };

  const startComment = () => {
    if (!editor || !canvasRef.current) return;
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const canvasRect = canvasRef.current.getBoundingClientRect();
    setCommentDraftTop(coords.top - canvasRect.top);
    draftOpenRef.current = true;
  };

  const closeCommentDraft = () => {
    setCommentDraftTop(null);
    draftOpenRef.current = false;
  };

  const submitComment = (text: string) => {
    // The editor keeps its selection while the margin textarea has
    // focus, so the mark applies to the originally selected range
    editor
      ?.chain()
      .focus()
      .setMark("comment", {
        "data-comment-id": crypto.randomUUID(),
        "data-comment-author": user.name.trim() || "Anonymous",
        "data-comment-text": text,
        "data-comment-created-at": new Date().toISOString(),
      })
      .run();
    closeCommentDraft();
  };

  const changeUserName = (name: string) => {
    const effectiveName = name.trim() || "Anonymous";
    // Color follows the identity: recomputed whenever the name changes
    const next = { ...user, name, color: colorForName(effectiveName) };
    setUser(next);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next));
    editor?.commands.updateUser({ ...next, name: effectiveName });
  };

  // Styled default for blockquotes, appended to the document's own CSS
  // when the user quotes something in a document that has no blockquote
  // styling. Marked so it is identifiable and never duplicated; being
  // part of headHtml, it applies in the editor, exports and PDF alike.
  const ensureBlockquoteStyle = () => {
    // App-created documents already style blockquotes via editor defaults
    if (!doc || doc.headHtml == null) return;
    if (doc.headHtml.includes('data-html-docs="blockquote"')) return;
    const { css } = extractStyles(doc.headHtml);
    if (/(^|[^\w-])blockquote/.test(css)) return;
    const styleBlock =
      '<style data-html-docs="blockquote">blockquote{margin:1em 0;padding:0.4em 0 0.4em 1.25em;border-left:4px solid #d0d4da;color:#5f6368;font-style:italic}</style>';
    updateDocument.mutate(
      { id, data: { headHtml: doc.headHtml + styleBlock } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetDocumentQueryKey(id),
          });
        },
      }
    );
  };

  const saveTitle = () => {
    const value = title.trim() || "Untitled";
    setTitle(value);
    if (value !== (doc?.title ?? "")) {
      updateDocument.mutate({ id, data: { title: value } });
      updateLocalDocTitle(id, value);
    }
  };

  const composeDocument = () =>
    composeFullDocument({
      headHtml: doc?.headHtml,
      bodyAttrs: doc?.bodyAttrs,
      // Comments are collaboration metadata: exports stay clean
      bodyHtml: stripComments(editor?.getHTML() ?? ""),
      title: title || "Document",
    });

  const exportPdf = async () => {
    if (!editor || pdfState === "loading") return;
    setPdfState("loading");
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: composeDocument() }),
      });
      if (!response.ok) throw new Error(`Erro ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title || "document"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPdfState("idle");
    } catch {
      setPdfState("error");
      setTimeout(() => setPdfState("idle"), 3000);
    }
  };


  // File > Save to: native save dialog (File System Access API) so the
  // user picks the destination; falls back to a classic download where
  // the API is unavailable (Firefox/Safari) or blocked.
  const downloadHtml = async () => {
    if (!editor) return;
    const html = composeDocument();
    const suggestedName = `${title || "document"}.html`;
    const picker = (
      window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: string) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [
            {
              description: "HTML document",
              accept: { "text/html": [".html", ".htm"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(html);
        await writable.close();
        return;
      } catch (error) {
        // User cancelled the dialog: not an error, and no fallback
        if ((error as DOMException)?.name === "AbortError") return;
        // Anything else (blocked, unsupported context): fall through
      }
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // Version history: preview swaps the document area for a read-only
  // snapshot; typing on it asks to restore (replacing newer history)
  const openPreview = async (at: number | null) => {
    if (at === null) {
      setPreviewVersion(null);
      return;
    }
    try {
      const response = await fetch(`/api/documents/${id}/versions/${at}`);
      if (!response.ok) return;
      setPreviewVersion(await response.json());
    } catch {
      // version fetch is best-effort; the sheet stays usable
    }
  };

  const restorePreviewedVersion = async () => {
    if (!previewVersion || !editKey || restoring) return;
    setRestoring(true);
    try {
      const response = await fetch(`/api/documents/${id}/versions/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ at: previewVersion.at }),
      });
      if (response.ok) {
        await provider.pullNow();
        setPreviewVersion(null);
        setConfirmRestore(false);
        setHistoryEpoch((n) => n + 1); // refresh the sheet's list
        // Back to live editing on the just-restored document
        setTimeout(() => editor?.commands.focus("end"), 0);
      }
    } finally {
      setRestoring(false);
    }
  };

  // File > Reset Document: clears all content back to a blank page.
  // A normal editor transaction, so it syncs to peers as a CRDT delta
  // and stays undoable (Ctrl/Cmd+Z) locally.
  const resetDocument = () => {
    if (!editor || viewMode) return;
    editor.chain().focus().clearContent(true).run();
  };

  // File > Open: imports an HTML file as a NEW document (preserving its
  // <head> styles and <body> attributes) and navigates to it — the
  // current document stays untouched at its own URL.
  const createDocument = useCreateDocument({
    mutation: {
      onSuccess: (response) => {
        router.push(
          `/doc/${response.data.id}/${response.data.editToken ?? ""}`
        );
      },
    },
  });
  const openHtmlFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = new DOMParser().parseFromString(text, "text/html");
      const docTitle =
        parsed.title.trim() || file.name.replace(/\.html?$/i, "") || "Untitled";
      const html = parsed.body.innerHTML.trim() || "<p></p>";
      const headHtml = parsed.head.innerHTML;
      const bodyAttrs = JSON.stringify(
        Object.fromEntries(
          Array.from(parsed.body.attributes).map((attr) => [
            attr.name,
            attr.value,
          ])
        )
      );
      createDocument.mutate({
        data: { title: docTitle, html, headHtml, bodyAttrs },
      });
    } catch {
      // unreadable file — ignore
    }
  };

  return (
    <div className="editor-page">
      <header className="editor-header">
        <FileMenu
          onOpenFile={openHtmlFile}
          onSaveHtml={downloadHtml}
          onExportPdf={exportPdf}
          onResetDocument={resetDocument}
          pdfState={pdfState}
        />
        <Link href="/" className="editor-back" title="New blank document">
          {/* Plain <img>: SVG needs no optimization and next/image
              refuses SVG sources without dangerouslyAllowSVG */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="EditWithMe" width={44} height={44} />
        </Link>
        <div className="editor-header-main">
          <input
            className="editor-title"
            value={title}
            placeholder="Untitled"
            readOnly={viewMode}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <div className="editor-meta">
            <span
              className={`status-dot status-${status}`}
              title={`Connection: ${status}`}
            />
            {viewMode && <span className="view-badge">View only</span>}
            <span className="editor-meta-text">
              {status === "connected"
                ? "Saved automatically"
                : status === "connecting"
                  ? "Connecting…"
                  : "Offline — changes saved locally"}
            </span>
          </div>
        </div>
        <div className="editor-header-right">
          <PresenceAvatars users={users} />
          <Input
            className="h-8 w-[130px] text-[13px]"
            value={user.name}
            placeholder="Your name"
            title="Your name (visible to others)"
            onChange={(e) => changeUserName(e.target.value)}
            onBlur={() => {
              if (!user.name.trim()) changeUserName("Anonymous");
            }}
          />
          {!viewMode && <ShareMenu docId={id} editKey={editKey} />}
          <Button
            variant="outline"
            size="sm"
            aria-label="Outline"
            aria-pressed={outline.open}
            title="Outline (Ctrl/⌘+Shift+O)"
            className={outline.open ? "bg-accent" : undefined}
            onClick={outline.toggle}
          >
            <ListTree />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Version history"
            title="Version history"
            onClick={() => {
              if (showHistory) setPreviewVersion(null);
              setShowHistory((open) => !open);
            }}
          >
            <History />
          </Button>
          {!viewMode && editKey && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAiConnect(true)}
              title="Connect an AI agent to this document via MCP"
            >
              <Sparkles /> AI Connect
            </Button>
          )}
        </div>
      </header>

      {!viewMode && (
        <Toolbar editor={editor} onBlockquoteApplied={ensureBlockquoteStyle} />
      )}

      {previewVersion && (
        <div className="history-banner">
          <History className="size-4" aria-hidden />
          <span>
            Viewing the version from{" "}
            {new Date(previewVersion.at).toLocaleString("en-US", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {!viewMode && " — start typing to edit it"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewVersion(null)}
          >
            Back to current
          </Button>
        </div>
      )}

      <div className="editor-canvas" ref={canvasRef}>
        {docCss && <style dangerouslySetInnerHTML={{ __html: docCss }} />}
        {outline.open && (
          <DocumentOutline
            headings={headings}
            hasToolbar={!viewMode}
            // On narrow screens the outline is an overlay over the text:
            // it gets out of the way once the reader has picked a section
            onNavigate={outline.narrow ? () => outline.setOpen(false) : undefined}
            onClose={() => outline.setOpen(false)}
          />
        )}
        <div
          className={[
            "doc-sheet",
            // Uploaded documents render with their own CSS only (as in the
            // browser); the editor's visual defaults apply only to blank
            // documents created in the app.
            !doc || doc.headHtml == null ? "doc-defaults" : "",
            // Print-like uploaded documents keep the A4 paper sheet;
            // viewport layouts get the full canvas (see detectPaperLayout)
            doc?.headHtml != null && paperLayout ? "doc-paper" : "",
            bodyAttrs.class ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
          ref={(el) => {
            if (el) el.style.cssText = bodyAttrs.style ?? "";
          }}
          onClick={() => {
            if (!previewVersion) editor?.commands.focus();
          }}
        >
          {/* The live editor is HIDDEN (never unmounted) while a version
              preview shows: ProseMirror owns its DOM and unmounting
              EditorContent mid-swap crashes React reconciliation */}
          <div style={{ display: previewVersion ? "none" : undefined }}>
            {editor && !viewMode && (
              <SelectionMenu
                editor={editor}
                onStartComment={startComment}
                draftOpenRef={draftOpenRef}
              />
            )}
            <EditorContent editor={editor} />
          </div>
          {previewVersion && (
            // The version snapshot in place of the live document. It is
            // editable (cursor placeable, selectable), but the FIRST
            // actual change is intercepted by a NATIVE beforeinput
            // listener (React's onBeforeInput is unreliable on
            // contentEditable): any edit — typing, paste, delete — is
            // blocked with preventDefault (so the DOM never mutates and
            // React stays consistent) and raises the restore-risk
            // question. Cursor movement/selection is not an input event,
            // so reading stays fluid.
            <div
              key={previewVersion.at}
              className="doc-content doc-preview"
              contentEditable={!viewMode}
              suppressContentEditableWarning
              spellCheck={false}
              ref={previewRef}
              dangerouslySetInnerHTML={{ __html: previewVersion.html }}
            />
          )}
        </div>
        {editor && commentDraftTop !== null && (
          <MarginCommentDraft
            top={commentDraftTop}
            onSubmit={submitComment}
            onCancel={closeCommentDraft}
          />
        )}
        {editor && comments.length > 0 && (
          <CommentsMargin
            comments={comments}
            activeId={activeCommentId}
            onRemove={removeCommentById}
            onEdit={updateCommentText}
            readOnly={viewMode}
          />
        )}
      </div>


      {showAiConnect && editKey && (
        <AiConnectModal
          docId={id}
          editKey={editKey}
          onClose={() => setShowAiConnect(false)}
        />
      )}

      {showHistory && (
        <HistorySheet
          key={historyEpoch}
          docId={id}
          previewAt={previewVersion?.at ?? null}
          onPreview={(at) => void openPreview(at)}
          onClose={() => {
            setShowHistory(false);
            setPreviewVersion(null);
          }}
        />
      )}

      {confirmRestore && previewVersion && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmRestore(false);
          }}
        >
          <DialogContent
            className="sm:max-w-[440px]"
            // The periodic CRDT pull momentarily refocuses the (hidden)
            // live editor, which Radix would read as "focus left" and
            // auto-close this dialog. Keep it open until the user picks
            // Cancel/Continue (Escape still closes).
            onInteractOutside={(event) => event.preventDefault()}
            onFocusOutside={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Edit this past version?</DialogTitle>
              <DialogDescription>
                If you edit the version from{" "}
                {new Date(previewVersion.at).toLocaleString("en-US", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                , everything written after it will be lost — for everyone —
                and the newer history discarded. Do you want to continue?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRestore(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void restorePreviewedVersion()}
                disabled={restoring}
              >
                {restoring ? "Restoring…" : "Continue editing"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
