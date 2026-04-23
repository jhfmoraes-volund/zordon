"use client";

import { useState } from "react";
import { Settings, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoamIntegrationCard } from "./integrations-card";

export default function SettingsPage() {
  const { userEmail } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleChangePassword = async () => {
    setMessage(null);

    if (!currentPassword) {
      setMessage({ type: "error", text: "Informe a senha atual." });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "A nova senha deve ter no minimo 6 caracteres." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "As senhas nao coincidem." });
      return;
    }

    setSaving(true);

    try {
      const supabase = createClient();

      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail!,
        password: currentPassword,
      });

      if (signInError) {
        setMessage({ type: "error", text: "Senha atual incorreta." });
        setSaving(false);
        return;
      }

      // Update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setMessage({ type: "error", text: updateError.message });
        setSaving(false);
        return;
      }

      setMessage({ type: "success", text: "Senha alterada com sucesso." });
      reset();
    } catch {
      setMessage({ type: "error", text: "Erro inesperado. Tente novamente." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <Settings className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Configuracoes</h1>
          <p className="text-sm text-muted-foreground">{userEmail}</p>
        </div>
      </div>

      {/* Integrations */}
      <RoamIntegrationCard />

      {/* Change password */}
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Alterar senha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Senha atual</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite a senha atual"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowCurrent(!showCurrent)}
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">Nova senha</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimo 6 caracteres"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNew(!showNew)}
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
              onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
            />
          </div>

          {message && (
            <p className={`text-sm ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
              {message.text}
            </p>
          )}

          <Button
            onClick={handleChangePassword}
            disabled={saving}
            className="w-full"
          >
            {saving ? "Salvando..." : "Alterar senha"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
