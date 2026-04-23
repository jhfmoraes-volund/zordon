"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Undo,
  Redo,
} from "lucide-react";

interface TiptapEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function TiptapEditor({
  content,
  onUpdate,
  placeholder = "Escreva aqui...",
  debounceMs = 800,
}: TiptapEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedUpdate = useCallback(
    (html: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUpdate(html), debounceMs);
    },
    [onUpdate, debounceMs]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      debouncedUpdate(e.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[120px] px-3 py-2 focus:outline-none",
      },
    },
  });

  if (!editor) return null;

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const tools = [
    {
      icon: Bold,
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      icon: Italic,
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    { type: "separator" as const },
    {
      icon: Heading1,
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive("heading", { level: 1 }),
    },
    {
      icon: Heading2,
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    { type: "separator" as const },
    {
      icon: List,
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    { type: "separator" as const },
    {
      icon: Link2,
      action: toggleLink,
      active: editor.isActive("link"),
    },
    { type: "separator" as const },
    {
      icon: Undo,
      action: () => editor.chain().focus().undo().run(),
      active: false,
    },
    {
      icon: Redo,
      action: () => editor.chain().focus().redo().run(),
      active: false,
    },
  ];

  return (
    <div className="surface-inset rounded-md overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50">
        {tools.map((tool, i) => {
          if ("type" in tool && tool.type === "separator") {
            return (
              <div
                key={i}
                className="w-px h-4 bg-border/50 mx-1"
              />
            );
          }
          const Tool = tool as { icon: typeof Bold; action: () => void; active: boolean };
          const Icon = Tool.icon;
          return (
            <Button
              key={i}
              type="button"
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${Tool.active ? "bg-muted" : ""}`}
              onClick={Tool.action}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          );
        })}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
