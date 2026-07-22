"use client";

import { useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Instructions modal for connecting an AI agent to THIS document over
// MCP. The connector URL is the document-scoped endpoint — the URL
// itself is the capability (id + edit key in the path), so the agent
// can read and edit only this document.
export function AiConnectModal({
  docId,
  editKey,
  onClose,
}: {
  docId: string;
  editKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"url" | "cli" | null>(null);

  const mcpUrl = new URL(
    `/api/mcp/doc/${docId}/${editKey}`,
    window.location.origin
  ).toString();
  const cliCommand = `claude mcp add --transport http editwithme "${mcpUrl}"`;

  const copy = async (what: "url" | "cli", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable (e.g. insecure context)
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" aria-hidden /> Connect an AI to this
            document
          </DialogTitle>
          <DialogDescription>
            The agent can read, edit and resolve comments — this document
            only. The URL contains the edit key: share it like the edit link.
          </DialogDescription>
        </DialogHeader>

        <div className="ai-connect-body">
          <div className="ai-connect-section">
            <h3>claude.ai — Settings → Connectors → Add custom connector</h3>
            <div className="ai-connect-code">
              <code>{mcpUrl}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy("url", mcpUrl)}
              >
                {copied === "url" ? <Check /> : <Copy />}
                {copied === "url" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="ai-connect-section">
            <h3>Claude Code — terminal</h3>
            <div className="ai-connect-code">
              <code>{cliCommand}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy("cli", cliCommand)}
              >
                {copied === "cli" ? <Check /> : <Copy />}
                {copied === "cli" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
