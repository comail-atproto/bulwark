import { withBasePath } from '@/lib/browser-navigation';

const artwork = {
  light: 'comail-logo.svg',
  dark: 'comail-logo-dark.svg',
  spooky: 'comail-logo-spooky.svg',
};

export function ComailWordmark({ theme, className = '' }: {
  theme: keyof typeof artwork;
  className?: string;
}) {
  return <img src={withBasePath(`/branding/comail/${artwork[theme]}`)} alt="comail" className={`inline-block h-[1em] w-[3.191em] align-middle ${className}`} />;
}
