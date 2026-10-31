import { toast } from '@/stores/toast-store';

export interface SpaceCalendarAuthorizationLabels {
  title: string;
  message: string;
  actionLabel: string;
}

export function showSpaceCalendarAuthorization(error: unknown, labels: SpaceCalendarAuthorizationLabels): boolean {
  if (!(error instanceof Error) || !('authorizationUrl' in error)) return false;
  const authorizationUrl = (error as Error & { authorizationUrl?: unknown }).authorizationUrl;
  if (typeof authorizationUrl !== 'string') return false;
  return showSpaceCalendarAuthorizationUrl(authorizationUrl, labels);
}

export function showSpaceCalendarAuthorizationUrl(authorizationUrl: string, labels: SpaceCalendarAuthorizationLabels): boolean {
  toast.warning(labels.title, {
    message: labels.message,
    duration: 15000,
    action: {
      label: labels.actionLabel,
      onClick: () => window.open(authorizationUrl, '_blank', 'noopener,noreferrer'),
    },
  });
  return true;
}
