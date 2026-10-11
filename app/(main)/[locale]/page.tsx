import { MailApp } from "@/components/mail/mail-app";

// The app root is the mail client. `/mail/...` (see mail/[[...segments]])
// serves the same component with a deep link applied; this route is the
// canonical entry point and keeps every existing bookmark to "/" working.
export default function Home() {
  return <MailApp />;
}
