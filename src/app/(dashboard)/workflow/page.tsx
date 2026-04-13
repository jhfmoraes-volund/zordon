"use client";

import { useState, useEffect } from "react";
import {
  ArrowRight, Lightbulb, Sparkles, FileText, Zap, Gauge,
  Users, Bot, AlertTriangle, BookOpen, Calculator,
} from "lucide-react";
import { workflowSections } from "@/lib/workflow-content";
import { ContentBlockRenderer } from "@/components/workflow/content-block";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  ArrowRight, Lightbulb, Sparkles, FileText, Zap, Gauge,
  Users, Bot, AlertTriangle, BookOpen, Calculator,
};

export default function WorkflowPage() {
  const [activeSection, setActiveSection] = useState(workflowSections[0]?.id || "");

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    for (const section of workflowSections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex gap-8">
      {/* Sidebar nav */}
      <nav className="hidden lg:block w-52 shrink-0 sticky top-6 self-start">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-[0.15em] mb-3">
          Workflow
        </p>
        <div className="space-y-0.5">
          {workflowSections.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => scrollTo(section.id)}
                className={`flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }`}
              >
                {(() => {
                  const Icon = iconMap[section.icon];
                  return Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null;
                })()}
                <span className="truncate">{section.title}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-12 pb-24">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold">Workflow Volund</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Guia operacional da esteira de desenvolvimento agentico.
          </p>
        </div>

        {/* Sections */}
        {workflowSections.map((section) => {
          const Icon = iconMap[section.icon];
          return (
            <section key={section.id} id={section.id} className="scroll-mt-6">
              {/* Section header */}
              <div className="flex items-center gap-2.5 mb-1">
                {Icon && <Icon className="h-5 w-5 text-primary" />}
                <h2 className="text-lg font-semibold">{section.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5">{section.summary}</p>

              {/* Content blocks */}
              <div className="space-y-4">
                {section.content.map((block, i) => (
                  <ContentBlockRenderer key={i} block={block} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
