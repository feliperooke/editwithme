"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Columns3,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HighlightButton } from "@/components/HighlightButton";

// Wraps each button in a tooltip with the action name and a short
// explanation. The <span> wrapper guarantees the tooltip shows even for
// disabled buttons (disabled buttons emit no mouse events).
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  description,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            className={`tb-btn${active ? " tb-btn-active" : ""}`}
            onClick={onClick}
            disabled={disabled}
            aria-label={title}
          >
            {children}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px] text-center">
        <span className="font-semibold">{title}</span>
        <span className="block text-[11px] leading-snug opacity-80">
          {description}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

const ICON = "size-4";

export function Toolbar({
  editor,
  onBlockquoteApplied,
}: {
  editor: Editor | null;
  onBlockquoteApplied?: () => void;
}) {
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  if (!editor) {
    return <div className="toolbar toolbar-loading" />;
  }

  const blockValue = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
    setLinkUrl("");
    setLinkInputOpen(false);
  };

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    setLinkInputOpen((open) => !open);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="toolbar">
        <div className="toolbar-inner">
          <ToolbarButton
            title="Undo"
            description="Undoes the last change — Ctrl/Cmd+Z"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo2 className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Redo"
            description="Redoes the undone change — Ctrl/Cmd+Shift+Z"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo2 className={ICON} />
          </ToolbarButton>

          <span className="tb-sep" />

          <Select
            value={blockValue}
            onValueChange={(value) => {
              if (value === "p") {
                editor.chain().focus().setParagraph().run();
              } else {
                const level = Number(value.slice(1)) as 1 | 2 | 3;
                editor.chain().focus().toggleHeading({ level }).run();
              }
            }}
          >
            <SelectTrigger
              className="h-[30px] w-[140px] border-0 bg-transparent shadow-none hover:bg-black/10"
              aria-label="Text style"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p">Normal text</SelectItem>
              <SelectItem value="h1">Heading 1</SelectItem>
              <SelectItem value="h2">Heading 2</SelectItem>
              <SelectItem value="h3">Heading 3</SelectItem>
            </SelectContent>
          </Select>

          <span className="tb-sep" />

          <ToolbarButton
            title="Bold"
            description="Makes the selected text bold — Ctrl/Cmd+B"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            description="Italicizes the selected text — Ctrl/Cmd+I"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            description="Underlines the selected text — Ctrl/Cmd+U"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Strikethrough"
            description="Strikes through the selected text — Ctrl/Cmd+Shift+S"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className={ICON} />
          </ToolbarButton>
          {/* No shadcn tooltip here: it fights with the press-and-hold
              palette; the native title attribute covers the hint */}
          <HighlightButton
            editor={editor}
            buttonClassName="tb-btn"
            activeClassName="tb-btn-active"
            paletteDirection="down"
          />

          <span className="tb-sep" />

          <ToolbarButton
            title="Align left"
            description="Aligns the current paragraph to the left margin"
            active={editor.isActive({ textAlign: "left" })}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeft className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Center"
            description="Centers the current paragraph on the page"
            active={editor.isActive({ textAlign: "center" })}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenter className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Align right"
            description="Aligns the current paragraph to the right margin"
            active={editor.isActive({ textAlign: "right" })}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          >
            <AlignRight className={ICON} />
          </ToolbarButton>

          <span className="tb-sep" />

          <ToolbarButton
            title="Bullet list"
            description="Turns the selection into a bulleted list (•)"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Numbered list"
            description="Turns the selection into a numbered list (1, 2, 3…)"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Blockquote"
            description="Formats the paragraph as a highlighted quote"
            active={editor.isActive("blockquote")}
            onClick={() => {
              editor.chain().focus().toggleBlockquote().run();
              // When the quote was applied (not removed), make sure the
              // document has a blockquote style to render it with
              if (editor.isActive("blockquote")) onBlockquoteApplied?.();
            }}
          >
            <Quote className={ICON} />
          </ToolbarButton>
          <ToolbarButton
            title="Code block"
            description="Formats the block as source code, in a monospaced font"
            active={editor.isActive("codeBlock")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Braces className={ICON} />
          </ToolbarButton>

          <span className="tb-sep" />

          <ToolbarButton
            title={editor.isActive("link") ? "Remove link" : "Insert link"}
            description={
              editor.isActive("link")
                ? "Removes the link from the selected text, keeping the text"
                : "Turns the selected text into a link — enter the URL and press Enter"
            }
            active={editor.isActive("link") || linkInputOpen}
            onClick={toggleLink}
          >
            {editor.isActive("link") ? (
              <Unlink className={ICON} />
            ) : (
              <Link className={ICON} />
            )}
          </ToolbarButton>
          {linkInputOpen && (
            <input
              className="tb-link-input"
              autoFocus
              placeholder="https://example.com — press Enter to apply"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLink();
                if (e.key === "Escape") setLinkInputOpen(false);
              }}
            />
          )}

          <ToolbarButton
            title="Insert table"
            description="Inserts a 3×3 table with a header row at the cursor position"
            active={editor.isActive("table")}
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            <Table className={ICON} />
          </ToolbarButton>
          {editor.isActive("table") && (
            <>
              <ToolbarButton
                title="Add row"
                description="Inserts a new row below the current table row"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                <Rows3 className={ICON} />
              </ToolbarButton>
              <ToolbarButton
                title="Add column"
                description="Inserts a new column to the right of the current one"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                <Columns3 className={ICON} />
              </ToolbarButton>
              <ToolbarButton
                title="Delete table"
                description="Removes the entire table and all of its content"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <Trash2 className={ICON} />
              </ToolbarButton>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
