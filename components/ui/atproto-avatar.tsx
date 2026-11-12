"use client";

import { useEffect, useState, type ComponentProps } from 'react';
import { Avatar } from './avatar';
import { useConfig } from '@/hooks/use-config';
import { useNoThirdPartyTraffic } from '@/hooks/use-third-party-mode';
import { avatarUrlAllowed } from '@/lib/outgoing-hosts';
import { resolveAtprotoAvatar } from '@/lib/atproto-avatar';

type AtprotoAvatarProps = ComponentProps<typeof Avatar> & { did?: string };

export function AtprotoAvatar({ did, contactPhoto, ...props }: AtprotoAvatarProps) {
  const { demoMode } = useConfig();
  const noThirdParty = useNoThirdPartyTraffic();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!did || demoMode || noThirdParty) return;
    let cancelled = false;
    async function resolve(actorDid: string) {
      try {
        const avatar = await resolveAtprotoAvatar(actorDid);
        if (!cancelled) setUrl(avatar);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void resolve(did);
    return () => { cancelled = true; };
  }, [did, demoMode, noThirdParty]);

  const avatar = !failed && avatarUrlAllowed(url) ? url : null;
  const native = <Avatar {...props} contactPhoto={avatar ? { uri: avatar } : contactPhoto} />;
  if (!did) return native;

  // Keep native rendering and fallback sources; a failed DID image restores
  // the original contact photo before the native plugin/favicon chain.
  return <div style={{ display: 'contents' }} onErrorCapture={(event) => {
    if (avatar && event.target instanceof HTMLImageElement && event.target.getAttribute('src') === avatar) setFailed(true);
  }}>{native}</div>;
}
