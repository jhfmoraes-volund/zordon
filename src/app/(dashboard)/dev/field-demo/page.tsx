"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { Textarea } from "@/components/ui/textarea";
import { TASK_STATUS } from "@/lib/status-chips";

export default function FieldDemoPage() {
  const [title, setTitle] = React.useState("");
  const [status, setStatus] = React.useState<string>("todo");
  const [moduleId, setModuleId] = React.useState<string>("");
  const [description, setDescription] = React.useState("");

  return (
    <div className="container mx-auto max-w-6xl space-y-10 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Field demo</h1>
          <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            DEV
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Matriz de variantes do primitivo <code>&lt;Field&gt;</code>. Densidade,
          erro, hint, addon, layout em colunas.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Densidade comfortable (default)</h2>
          <p className="text-sm text-muted-foreground">
            <code>--field-h: 2.25rem</code> — 36px.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormBody density="comfortable">
              <Field name="title-comfortable" required>
                <Field.Label>Título</Field.Label>
                <Field.Control>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Digite o título…"
                  />
                </Field.Control>
              </Field>

              <Field.Row cols={2}>
                <Field name="status-comfortable">
                  <Field.Label>Status</Field.Label>
                  <Field.Control>
                    <StatusChipSelect
                      variant="input"
                      value={status}
                      options={TASK_STATUS}
                      onValueChange={(v) => setStatus(v)}
                    />
                  </Field.Control>
                </Field>

                <Field name="module-comfortable">
                  <Field.Label
                    addon={
                      <Button size="xs" variant="ghost">
                        <Plus />
                        Novo
                      </Button>
                    }
                  >
                    Módulo
                  </Field.Label>
                  <Field.Control>
                    <Select value={moduleId} onValueChange={(v) => setModuleId(v ?? "")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="onboarding">Onboarding</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field.Control>
                  <Field.Hint tone="warning">Alpha sugeriu: Onboarding</Field.Hint>
                </Field>
              </Field.Row>

              <Field name="description-comfortable">
                <Field.Label>Descrição</Field.Label>
                <Field.Control>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Detalhes…"
                    className="min-h-24"
                  />
                </Field.Control>
              </Field>
            </FormBody>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Densidade compact</h2>
          <p className="text-sm text-muted-foreground">
            <code>--field-h: 2rem</code> — 32px. Override via{" "}
            <code>data-density=&quot;compact&quot;</code>.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormBody density="compact">
              <Field name="title-compact">
                <Field.Label>Título</Field.Label>
                <Field.Control>
                  <Input placeholder="Compacto…" />
                </Field.Control>
              </Field>

              <Field.Row cols={2}>
                <Field name="status-compact">
                  <Field.Label>Status</Field.Label>
                  <Field.Control>
                    <StatusChipSelect
                      variant="input"
                      value="todo"
                      options={TASK_STATUS}
                      onValueChange={() => {}}
                    />
                  </Field.Control>
                </Field>
                <Field name="select-compact">
                  <Field.Label>Select</Field.Label>
                  <Field.Control>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="a">Opção A</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field.Control>
                </Field>
              </Field.Row>
            </FormBody>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Estados</h2>
          <p className="text-sm text-muted-foreground">
            Erro, required, hint, addon. <code>aria-invalid</code> e{" "}
            <code>aria-describedby</code> injetados automaticamente.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormBody density="comfortable">
              <Field name="error-demo" required error="Título é obrigatório">
                <Field.Label>Com erro + required</Field.Label>
                <Field.Control>
                  <Input placeholder="Vazio…" />
                </Field.Control>
              </Field>

              <Field name="hint-demo">
                <Field.Label>Com hint</Field.Label>
                <Field.Control>
                  <Input placeholder="Texto livre" />
                </Field.Control>
                <Field.Hint>Mín. 3 caracteres.</Field.Hint>
              </Field>

              <Field.Row cols={3}>
                <Field name="col1">
                  <Field.Label>Col 1</Field.Label>
                  <Field.Control>
                    <Input />
                  </Field.Control>
                </Field>
                <Field name="col2">
                  <Field.Label>Col 2</Field.Label>
                  <Field.Control>
                    <Input />
                  </Field.Control>
                </Field>
                <Field name="col3">
                  <Field.Label>Col 3</Field.Label>
                  <Field.Control>
                    <Input />
                  </Field.Control>
                </Field>
              </Field.Row>
            </FormBody>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">A11y</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Como validar</CardTitle>
            <CardDescription>
              Clique no label de qualquer campo acima — o foco vai pro control
              (htmlFor injetado). Inspecione no DevTools: <code>id</code>,
              <code>aria-describedby</code>, <code>aria-invalid</code>,
              <code>aria-required</code> aparecem no input/trigger.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    </div>
  );
}
