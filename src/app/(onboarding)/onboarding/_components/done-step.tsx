"use client";

import { motion } from "framer-motion";
import { CheckCircle2, KanbanSquare, MessagesSquare, Bot } from "lucide-react";
import { roleLabel, specialtyLabel } from "@/lib/roles";

type Props = {
  memberName: string;
  role: string;
  specialty: string;
  seniority: string;
  fpCapacity: number;
};

const SENIORITY_LABELS: Record<string, string> = {
  junior: "Júnior",
  pleno: "Pleno",
  senior: "Sênior",
  principal: "Principal",
};

const TOUR = [
  {
    icon: KanbanSquare,
    title: "Tasks & sprints",
    body: "Onde sua entrega vive. Tasks alocadas, sprints quinzenais.",
  },
  {
    icon: MessagesSquare,
    title: "Design sessions",
    body: "Reuniões de inception e CI estruturadas — a fonte das tasks.",
  },
  {
    icon: Bot,
    title: "Alpha agent",
    body: "Seu copilot interno. Botão no header em qualquer página.",
  },
] as const;

export function DoneStep({
  memberName,
  role,
  specialty,
  seniority,
  fpCapacity,
}: Props) {
  const firstName = memberName.split(" ")[0] ?? memberName;

  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 12, stiffness: 120, delay: 0.1 }}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
      >
        <CheckCircle2 className="h-3 w-3" />
        Tudo pronto
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Bom te ter aqui, {firstName}.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Seu perfil tá calibrado. Aqui vai um resumo + os três lugares que
          você mais vai usar.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, ease: "easeOut" }}
        className="rounded-xl border border-border bg-card p-4"
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Role" value={roleLabel(role)} />
          <Row label="Especialidade" value={specialtyLabel(specialty)} />
          <Row
            label="Senioridade"
            value={SENIORITY_LABELS[seniority] ?? seniority}
          />
          <Row label="Capacidade" value={`${fpCapacity} FP/sem`} />
        </dl>
      </motion.div>

      <ul className="space-y-2">
        {TOUR.map((item, i) => (
          <motion.li
            key={item.title}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + i * 0.08, ease: "easeOut" }}
            className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3"
          >
            <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
              <item.icon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.body}</div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </>
  );
}
