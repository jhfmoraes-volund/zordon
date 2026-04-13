"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Palette, Shield, Package, Image, Gauge, FileCode, Building2,
  ChevronDown, ChevronRight, Loader2, Download, Save, Trash2,
} from "lucide-react";

type Guideline = {
  id: string;
  category: string;
  title: string;
  content: string;
  isDefault: boolean;
};

const categoryIcons: Record<string, React.ReactNode> = {
  design: <Palette className="h-4 w-4" />,
  security: <Shield className="h-4 w-4" />,
  libraries: <Package className="h-4 w-4" />,
  icons: <Image className="h-4 w-4" />,
  "rate-limit": <Gauge className="h-4 w-4" />,
  conventions: <FileCode className="h-4 w-4" />,
  architecture: <Building2 className="h-4 w-4" />,
};

export function ProjectGuidelines({ projectId }: { projectId: string }) {
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = () => {
    fetch(`/api/projects/${projectId}/guidelines`)
      .then((r) => r.json())
      .then(setGuidelines);
  };

  useEffect(() => { load(); }, [projectId]);

  const loadDefaults = async () => {
    setLoading(true);
    await fetch(`/api/projects/${projectId}/guidelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loadDefaults: true }),
    });
    load();
    setLoading(false);
  };

  const toggle = (category: string) => {
    if (expanded === category) {
      setExpanded(null);
      setEditing(null);
    } else {
      setExpanded(category);
      setEditing(null);
    }
  };

  const startEdit = (g: Guideline) => {
    setEditing(g.category);
    setEditContent(g.content);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const saveEdit = async (g: Guideline) => {
    setSaving(true);
    await fetch(`/api/projects/${projectId}/guidelines/${g.category}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: g.title, content: editContent }),
    });
    setEditing(null);
    load();
    setSaving(false);
  };

  const remove = async (category: string) => {
    if (!confirm("Remover esta guideline?")) return;
    await fetch(`/api/projects/${projectId}/guidelines/${category}`, {
      method: "DELETE",
    });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Guidelines instruem a IA sobre como gerar código para este projeto.
        </p>
        <Button variant="outline" onClick={loadDefaults} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {guidelines.length === 0 ? "Carregar Padrões" : "Resetar Padrões"}
        </Button>
      </div>

      {guidelines.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma guideline configurada. Clique em &quot;Carregar Padrões&quot; para começar.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {guidelines.map((g) => (
            <Card key={g.id}>
              <CardHeader
                className="cursor-pointer py-3 px-4"
                onClick={() => toggle(g.category)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expanded === g.category ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    {categoryIcons[g.category]}
                    <CardTitle className="text-sm font-medium">{g.title}</CardTitle>
                    {g.isDefault && (
                      <Badge variant="secondary" className="text-xs">padrão</Badge>
                    )}
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => remove(g.category)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {expanded === g.category && (
                <CardContent className="pt-0 px-4 pb-4">
                  {editing === g.category ? (
                    <div className="space-y-2">
                      <Textarea
                        ref={textareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={15}
                        className="font-mono text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => saveEdit(g)} disabled={saving} className="gap-1">
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="prose prose-sm max-w-none cursor-pointer rounded-md p-3 bg-muted/50 hover:bg-muted transition-colors"
                      onClick={() => startEdit(g)}
                    >
                      <pre className="whitespace-pre-wrap text-sm font-mono">{g.content}</pre>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
