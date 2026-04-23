"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, File, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  extractedText: string;
};

export function FileUpload({
  files,
  uploading,
  onUpload,
  onRemove,
}: {
  files: UploadedFile[];
  uploading: boolean;
  onUpload: (fileList: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        onUpload(e.dataTransfer.files);
      }
    },
    [onUpload]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20 hover:border-muted-foreground/40"
        }`}
      >
        {uploading ? (
          <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground/50" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploading ? "Processando arquivos..." : "Arraste arquivos aqui"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, DOCX, TXT, MD
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => e.target.files && onUpload(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <File className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(f.size)} · {f.extractedText.length} caracteres extraidos
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(f.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
