"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Upload,
  Trash2,
  Eye,
  Lock,
  Unlock,
  Download,
  ShieldCheck,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingItem, ToggleSwitch } from "@/components/settings/settings-section";
import { SmimePassphraseDialog } from "@/components/settings/smime-passphrase-dialog";
import { SmimeCertificateModal } from "@/components/settings/smime-certificate-modal";
import { useSmimeStore } from "@/stores/smime-store";
import { useIdentityStore } from "@/stores/identity-store";
import { useAuthStore } from "@/stores/auth-store";
import { exportPkcs12, downloadPkcs12 } from "@/lib/smime/pkcs12-export";
import type { SmimeKeyRecord, SmimePublicCert } from "@/lib/smime/types";

export function SmimeSettings() {
  const t = useTranslations("smime");
  const {
    keyRecords,
    publicCerts,
    identityKeyBindings,
    defaultSignIdentity,
    defaultEncrypt,
    autoImportSignerCerts,
    isLoading,
    error,
    load,
    importPKCS12,
    removeKeyRecord,
    removePublicCert,
    bindIdentityToKey,
    unlockKey,
    lockKey,
    setSignDefault,
    setEncryptDefault,
    setAutoImportSignerCerts,
    isKeyUnlocked,
    setError,
  } = useSmimeStore();

  const { identities } = useIdentityStore();
  const activeAccountId = useAuthStore((s) => s.activeAccountId);

  // Local UI state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [unlockTargetId, setUnlockTargetId] = useState<string | null>(null);
  const [certModalRecord, setCertModalRecord] = useState<SmimeKeyRecord | SmimePublicCert | null>(null);
  const [certModalType, setCertModalType] = useState<"private" | "public">("private");
  const [importError, setImportError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<ArrayBuffer | null>(null);
  const [pendingP12Pass, setPendingP12Pass] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pubCertInputRef = useRef<HTMLInputElement>(null);

  // State for the two-step PKCS#12 flow
  const [importStep, setImportStep] = useState<"p12" | "storage">("p12");

  // Export flow state
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTargetRecord, setExportTargetRecord] = useState<SmimeKeyRecord | null>(null);
  const [exportStep, setExportStep] = useState<"storage" | "export">("storage");
  const [exportStoragePass, setExportStoragePass] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    load(activeAccountId ?? undefined);
  }, [load, activeAccountId]);

  // ── PKCS#12 import flow ────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPendingFile(reader.result as ArrayBuffer);
      setImportStep("p12");
      setImportError(null);
      setImportDialogOpen(true);
    };
    reader.readAsArrayBuffer(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleImportSubmit = async (passphrase: string) => {
    if (importStep === "p12") {
      setPendingP12Pass(passphrase);
      setImportStep("storage");
      setImportError(null);
      return;
    }

    // Storage passphrase step
    if (!pendingFile) return;
    try {
      await importPKCS12(pendingFile, pendingP12Pass, passphrase);
      setImportDialogOpen(false);
      setPendingFile(null);
      setPendingP12Pass("");
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    }
  };

  // ── Public cert import ─────────────────────────────────────────

  const handlePublicCertFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const store = useSmimeStore.getState();
        await store.importPublicCert(reader.result as ArrayBuffer, "manual");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import certificate");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // ── Unlock ─────────────────────────────────────────────────────

  const handleUnlockRequest = (id: string) => {
    setUnlockTargetId(id);
    setUnlockError(null);
    setUnlockDialogOpen(true);
  };

  const handleUnlockSubmit = async (passphrase: string) => {
    if (!unlockTargetId) return;
    try {
      await unlockKey(unlockTargetId, passphrase);
      setUnlockDialogOpen(false);
      setUnlockTargetId(null);
      setUnlockError(null);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "Unlock failed");
    }
  };

  // ── Export flow ────────────────────────────────────────────────

  const handleExportRequest = (record: SmimeKeyRecord) => {
    setExportTargetRecord(record);
    setExportStep("storage");
    setExportStoragePass("");
    setExportError(null);
    setExportDialogOpen(true);
  };

  const handleExportSubmit = async (passphrase: string) => {
    if (!exportTargetRecord) return;

    if (exportStep === "storage") {
      // Verify storage passphrase by attempting to decrypt
      try {
        const { decryptPrivateKeyBytes } = await import("@/lib/smime/pkcs12-import");
        await decryptPrivateKeyBytes(exportTargetRecord, passphrase);
        setExportStoragePass(passphrase);
        setExportStep("export");
        setExportError(null);
      } catch {
        setExportError(t("incorrect_passphrase"));
      }
      return;
    }

    // Export passphrase step
    try {
      const p12Bytes = await exportPkcs12(exportTargetRecord, exportStoragePass, passphrase);
      const filename = `${exportTargetRecord.email.replace(/[^a-zA-Z0-9.-]/g, '_')}.p12`;
      downloadPkcs12(p12Bytes, filename);
      setExportDialogOpen(false);
      setExportTargetRecord(null);
      setExportStoragePass("");
      setExportError(null);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    }
  };

  // ── Helpers ────────────────────────────────────────────────────

  const isExpired = (dateStr: string) => new Date(dateStr) < new Date();

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const getBoundIdentityNames = (keyId: string): string[] => {
    return Object.entries(identityKeyBindings)
      .filter(([, kId]) => kId === keyId)
      .map(([identityId]) => {
        const identity = identities.find((i) => i.id === identityId);
        return identity?.email ?? identityId;
      });
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* ── Your Certificates ──────────────────────────────────── */}
      <SettingsSection
        title={t("your_certificates")}
        description={t("your_certificates_desc")}
      >
        <div className="space-y-2">
          {keyRecords.map((record) => {
            const expired = isExpired(record.notAfter);
            const unlocked = isKeyUnlocked(record.id);
            const boundIdentities = getBoundIdentityNames(record.id);

            return (
              <div
                key={record.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${expired ? "bg-destructive/10" : "bg-primary/10"}`}>
                    {expired ? (
                      <ShieldAlert className="w-4 h-4 text-destructive" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {record.email || record.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {record.issuer} · {t("expires")} {formatDate(record.notAfter)}
                      {expired && <span className="text-destructive ml-1">({t("expired")})</span>}
                    </p>
                    {boundIdentities.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("bound_to")}: {boundIdentities.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {unlocked ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => lockKey(record.id)}
                      title={t("lock")}
                    >
                      <Unlock className="w-4 h-4 text-green-600" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleUnlockRequest(record.id)}
                      title={t("unlock")}
                    >
                      <Lock className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setCertModalRecord(record);
                      setCertModalType("private");
                    }}
                    title={t("details")}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleExportRequest(record)}
                    title={t("export")}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeKeyRecord(record.id)}
                    title={t("delete")}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}

          {keyRecords.length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t("no_certificates")}
            </p>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".p12,.pfx"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="mt-2"
        >
          <Upload className="w-4 h-4 mr-2" />
          {t("import_pkcs12")}
        </Button>
      </SettingsSection>

      {/* ── Recipient Certificates ─────────────────────────────── */}
      <SettingsSection
        title={t("recipient_certificates")}
        description={t("recipient_certificates_desc")}
      >
        <div className="space-y-2">
          {publicCerts.map((cert) => {
            const expired = isExpired(cert.notAfter);

            return (
              <div
                key={cert.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {cert.email || cert.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cert.issuer} · {cert.source}
                      {expired && <span className="text-destructive ml-1">({t("expired")})</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setCertModalRecord(cert);
                      setCertModalType("public");
                    }}
                    title={t("details")}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePublicCert(cert.id)}
                    title={t("delete")}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}

          {publicCerts.length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t("no_recipient_certs")}
            </p>
          )}
        </div>

        <input
          ref={pubCertInputRef}
          type="file"
          accept=".pem,.cer,.crt,.der"
          className="hidden"
          onChange={handlePublicCertFile}
        />
        <Button
          variant="outline"
          onClick={() => pubCertInputRef.current?.click()}
          disabled={isLoading}
          className="mt-2"
        >
          <Upload className="w-4 h-4 mr-2" />
          {t("import_public_cert")}
        </Button>
      </SettingsSection>

      {/* ── Identity Bindings ──────────────────────────────────── */}
      {identities.length > 0 && keyRecords.length > 0 && (
        <SettingsSection
          title={t("identity_bindings")}
          description={t("identity_bindings_desc")}
        >
          {identities.map((identity) => {
            const boundKeyId = identityKeyBindings[identity.id];
            return (
              <SettingItem key={identity.id} label={identity.email}>
                <select
                  value={boundKeyId ?? ""}
                  onChange={(e) =>
                    bindIdentityToKey(identity.id, e.target.value || null)
                  }
                  className="text-sm bg-background border border-border rounded-md px-2 py-1"
                >
                  <option value="">{t("no_key_bound")}</option>
                  {keyRecords.map((kr) => (
                    <option key={kr.id} value={kr.id}>
                      {kr.email} ({kr.algorithm})
                    </option>
                  ))}
                </select>
              </SettingItem>
            );
          })}
        </SettingsSection>
      )}

      {/* ── Defaults ───────────────────────────────────────────── */}
      <SettingsSection
        title={t("defaults_title")}
        description={t("defaults_desc")}
      >
        <SettingItem
          label={t("encrypt_by_default")}
          description={t("encrypt_by_default_desc")}
        >
          <ToggleSwitch
            checked={defaultEncrypt}
            onChange={setEncryptDefault}
          />
        </SettingItem>

        <SettingItem
          label={t("auto_import_signer_certs")}
          description={t("auto_import_signer_certs_desc")}
        >
          <ToggleSwitch
            checked={autoImportSignerCerts}
            onChange={setAutoImportSignerCerts}
          />
        </SettingItem>

        {identities.map((identity) => {
          const bound = identityKeyBindings[identity.id];
          if (!bound) return null;
          return (
            <SettingItem
              key={identity.id}
              label={`${t("sign_default_for")} ${identity.email}`}
            >
              <ToggleSwitch
                checked={defaultSignIdentity[identity.id] ?? false}
                onChange={(v) => setSignDefault(identity.id, v)}
              />
            </SettingItem>
          );
        })}
      </SettingsSection>

      {/* ── Dialogs ────────────────────────────────────────────── */}
      <SmimePassphraseDialog
        isOpen={importDialogOpen}
        onClose={() => {
          setImportDialogOpen(false);
          setPendingFile(null);
          setPendingP12Pass("");
          setImportError(null);
          setImportStep("p12");
        }}
        onSubmit={handleImportSubmit}
        title={importStep === "p12" ? t("enter_p12_passphrase") : t("enter_storage_passphrase")}
        description={importStep === "p12" ? t("p12_passphrase_desc") : t("storage_passphrase_desc")}
        submitText={importStep === "p12" ? t("next") : t("import")}
        error={importError}
        showConfirm={importStep === "storage"}
      />

      <SmimePassphraseDialog
        isOpen={unlockDialogOpen}
        onClose={() => {
          setUnlockDialogOpen(false);
          setUnlockTargetId(null);
          setUnlockError(null);
        }}
        onSubmit={handleUnlockSubmit}
        title={t("unlock_key")}
        description={t("unlock_key_desc")}
        error={unlockError}
      />

      <SmimeCertificateModal
        isOpen={!!certModalRecord}
        onClose={() => setCertModalRecord(null)}
        record={certModalRecord}
        type={certModalType}
      />

      <SmimePassphraseDialog
        isOpen={exportDialogOpen}
        onClose={() => {
          setExportDialogOpen(false);
          setExportTargetRecord(null);
          setExportStoragePass("");
          setExportError(null);
          setExportStep("storage");
        }}
        onSubmit={handleExportSubmit}
        title={exportStep === "storage" ? t("enter_storage_passphrase") : t("enter_export_passphrase")}
        description={exportStep === "storage" ? t("export_storage_desc") : t("export_passphrase_desc")}
        submitText={exportStep === "storage" ? t("next") : t("export")}
        error={exportError}
        showConfirm={exportStep === "export"}
      />
    </div>
  );
}
