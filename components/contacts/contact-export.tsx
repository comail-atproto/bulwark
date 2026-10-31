"use client";

import { generateVCard } from "@/lib/vcard";
import type { ContactCard } from "@/lib/jmap/types";
import { getContactDisplayName } from "@/stores/contact-store";

export function exportContact(contact: ContactCard) {
  const vcf = generateVCard([contact]);
  const name = getContactDisplayName(contact) || "contact";
  downloadVcf(vcf, `${sanitizeFilename(name)}.vcf`);
}

export function exportContacts(contacts: ContactCard[]) {
  const vcf = generateVCard(contacts);
  downloadVcf(vcf, `contacts-${new Date().toISOString().slice(0, 10)}.vcf`);
}

function downloadVcf(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
}
