import { getTranslations } from "next-intl/server";
import { MailtoProtocolClient } from "@/components/protocol/mailto-protocol-client";

export default async function MailtoProtocolPage() {
  const t = await getTranslations("protocol_handlers");

  return <MailtoProtocolClient openingText={t("opening_mailto")} />;
}
