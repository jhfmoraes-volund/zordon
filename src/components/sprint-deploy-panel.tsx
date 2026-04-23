"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rocket, ArrowUpCircle, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type SprintDeploy = {
  id: string;
  environment: string;
  status: string;
  tasksIncluded: string[];
  tasksFailed: Array<{ taskId: string; error: string }>;
  triggeredBy: string | null;
  commitSha: string | null;
  errorLog: string | null;
  startedAt: string;
  completedAt: string | null;
};

const deployStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  deploying: "bg-yellow-100 text-yellow-700",
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  rolled_back: "bg-orange-100 text-orange-700",
};

const deployStatusIcons: Record<string, React.ReactNode> = {
  pending: null,
  deploying: <Loader2 className="h-3 w-3 animate-spin" />,
  success: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  rolled_back: <AlertTriangle className="h-3 w-3" />,
};

export function SprintDeployPanel({
  sprintId,
  approvedCount,
  stagingCount,
}: {
  sprintId: string;
  approvedCount: number;
  stagingCount: number;
}) {
  const [deploys, setDeploys] = useState<SprintDeploy[]>([]);
  const [deploying, setDeploying] = useState(false);

  const loadDeploys = () => {
    fetch(`/api/sprints/${sprintId}/deploys`)
      .then((r) => r.json())
      .then(setDeploys);
  };

  useEffect(() => {
    loadDeploys();
  }, [sprintId]);

  const triggerDeploy = async (environment: "staging" | "production") => {
    if (!confirm(`Deploy to ${environment}?`)) return;

    setDeploying(true);
    try {
      await fetch(`/api/sprints/${sprintId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment }),
      });
      loadDeploys();
    } finally {
      setDeploying(false);
    }
  };

  const lastStagingDeploy = deploys.find(
    (d) => d.environment === "staging" && d.status === "success"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Deploy Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            onClick={() => triggerDeploy("staging")}
            disabled={deploying || approvedCount === 0}
            variant="outline"
            className="gap-2"
          >
            {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
            Deploy to Staging
            {approvedCount > 0 && (
              <Badge variant="secondary" className="ml-1">{approvedCount} tasks</Badge>
            )}
          </Button>

          <Button
            onClick={() => triggerDeploy("production")}
            disabled={deploying || stagingCount === 0 || !lastStagingDeploy}
            className="gap-2"
          >
            {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Promote to Production
            {stagingCount > 0 && (
              <Badge variant="secondary" className="ml-1">{stagingCount} tasks</Badge>
            )}
          </Button>
        </div>

        {/* Deploy history */}
        {deploys.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Deploy History</p>
            {deploys.map((d) => {
              const included = d.tasksIncluded ?? [];
              const failed = d.tasksFailed ?? [];

              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge className={deployStatusColors[d.status]}>
                      <span className="flex items-center gap-1">
                        {deployStatusIcons[d.status]}
                        {d.status}
                      </span>
                    </Badge>
                    <Badge variant="outline">{d.environment}</Badge>
                    <span className="text-muted-foreground">
                      {new Date(d.startedAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {included.length > 0 && (
                      <span className="text-green-600 text-xs">
                        {included.length} merged
                      </span>
                    )}
                    {failed.length > 0 && (
                      <span className="text-red-600 text-xs">
                        {failed.length} failed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
