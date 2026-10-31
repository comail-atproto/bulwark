import { getTranslations } from "next-intl/server";
import { WebcalProtocolClient } from "@/components/protocol/webcal-protocol-client";

export default async function WebcalProtocolPage() {
  const t = await getTranslations("protocol_handlers");

  return <WebcalProtocolClient openingText={t("opening_webcal")} />;
}
