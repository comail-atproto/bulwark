"use client";

import { Menu, ArrowLeft, Plus, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useConfig } from "@/hooks/use-config";
import { useThemeStore } from "@/stores/theme-store";
import { withBasePath } from "@/lib/browser-navigation";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "@/components/layout/account-switcher";

// comail brand masthead for the mobile list pane. Mirrors the mock: a deep-teal
// bar carrying cammie + the cream "comail" wordmark (cyan "c") + the account
// avatar. Only rendered for the comail theme; every other theme keeps the plain
// bg-background MobileHeader, and this component is never rendered on desktop
// (useIsDesktop short-circuits above).
//
// AA: cream #ecefcf on teal #02413c = 9.77:1 (AAA). The cyan "c" uses a lifted
// cyan #8fd2e8 (6.88:1) rather than brand cyan #3fa1c0, which is only 3.88:1
// on the teal bar. Cammie's mark is transparent, so it sits directly on the
// teal bar — matching the desktop rail (see comail-brand-aa-insufficiency memory).
function ComailMasthead({ title, onMenu, onCompose }: { title: string; onMenu: () => void; onCompose?: () => void }) {
  const t = useTranslations('sidebar');
  const { appLogoDarkUrl } = useConfig();
  // The mobile list masthead is always the dark/cream wordmark (the bar is
  // teal in both light and dark comail mode), matching the desktop rail.
  const logoUrl = withBasePath(appLogoDarkUrl);

  return (
    <header
      className={cn(
        "flex items-center gap-2 px-2.5 h-14 shrink-0",
        "bg-[#02413c] text-[#ecefcf] border-b border-[#0a5249]"
      )}
      data-theme-skin-target
    >
      {/* Menu (opens folder sidebar) — cream glyph on teal, 44px target */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenu}
        className="h-11 w-11 text-[#ecefcf] hover:bg-[#1a5466] hover:text-white"
        aria-label="Toggle menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Cammie mark — transparent, sits directly on the teal bar (matches the desktop rail) */}
      <span className="flex h-7 w-7 items-center justify-center flex-shrink-0">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-7 w-7 object-contain" />
        ) : (
          <span className="font-serif text-[#ecefcf] text-lg leading-none" style={{ fontFamily: 'var(--comail-font-display), serif' }}>c</span>
        )}
      </span>

      {/* Wordmark: cream "comail" with lifted-cyan "c" */}
      <span
        className="font-bold text-[21px] leading-none whitespace-nowrap"
        style={{ fontFamily: 'var(--comail-font-display), "Young Serif", serif' }}
      >
        <span className="text-[#8fd2e8]">c</span>
        <span className="text-[#ecefcf]">omail</span>
      </span>

      {/* Active mailbox name as a muted cream subtitle, truncated */}
      <span className="ml-1 min-w-0 flex-1 truncate text-[13px] text-[#a8b3a0] font-medium">{title}</span>

      {onCompose && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onCompose}
          className="h-11 w-11 text-[#8fd2e8] hover:bg-[#1a5466] hover:text-white"
          aria-label={t('mobile.compose')}
        >
          <Plus className="h-5 w-5" />
        </Button>
      )}
    </header>
  );
}

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onCompose?: () => void;
  onSearch?: () => void;
  className?: string;
  /** Id of the sidebar this header's menu button toggles. */
  sidebarId?: string;
  /**
   * When set, the mailbox title is replaced by a tappable search field and
   * this fires instead. The folder name stays visible in the drawer, so the
   * bar spends its width on the thing you act on rather than a label.
   */
  onOpenSearch?: () => void;
  /** Placeholder shown inside the search field. */
  searchPlaceholder?: string;
  /** Clears the active query without opening the search panel. */
  onClearSearch?: () => void;
  /** Whether a query is currently applied, which reveals the clear button. */
  searchActive?: boolean;
}

export function MobileHeader({
  title,
  showBack = false,
  onBack,
  onCompose,
  onSearch,
  className,
  sidebarId,
  onOpenSearch,
  searchPlaceholder,
  onClearSearch,
  searchActive = false,
}: MobileHeaderProps) {
  const t = useTranslations('sidebar');
  const { toggleSidebar, goBack, sidebarOpen } = useUIStore();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  // Pane-aware: in Pro split mode the viewport is desktop-wide while the
  // pane is narrow. The Tailwind `lg:hidden` variant alone would never fire
  // there, so we additionally hide via JS when the surrounding pane is
  // desktop-sized. Outside of Pro this still returns the viewport value.
  const isPaneDesktop = useIsDesktop();
  if (isPaneDesktop) return null;

  // comail brand masthead on the list pane (menu + cammie + wordmark). Only
  // when not in a back/viewer context — the read view uses MobileViewerHeader.
  const isComail = activeThemeId === 'builtin-comail';
  if (isComail && !showBack) {
    return <ComailMasthead title={title} onMenu={toggleSidebar} onCompose={onCompose} />;
  }

  const handleLeftAction = () => {
    if (showBack && onBack) {
      onBack();
    } else if (showBack) {
      goBack();
    } else {
      toggleSidebar();
    }
  };

  return (
    <header
      className={cn(
        "flex items-center justify-between px-4 h-14 border-b border-border bg-background shrink-0",
        className
      )}
    >
      {/* Left action: Menu or Back button */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLeftAction}
          className={cn(
            "h-11 w-11",
            !showBack && sidebarOpen && "bg-accent"
          )}
          data-sidebar-toggle={!showBack ? "" : undefined}
          aria-label={showBack ? t('mobile.go_back') : t('mobile.toggle_menu')}
          aria-expanded={!showBack ? sidebarOpen : undefined}
          aria-controls={!showBack ? sidebarId : undefined}
        >
          {showBack ? (
            <ArrowLeft className="h-5 w-5" />
          ) : sidebarOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>

        {/* Title, unless the bar is in search-first mode */}
        {!onOpenSearch && <h1 className="font-semibold text-lg truncate">{title}</h1>}
      </div>

      {onOpenSearch && (
        /* Not a single button: the clear control is a button of its own, and
           nesting one inside another is invalid markup. */
        <div className="flex-1 min-w-0 h-10 mx-1 flex items-center rounded-full bg-muted ps-3 pe-1">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex-1 min-w-0 h-full flex items-center gap-2 text-start text-muted-foreground"
            aria-label={searchPlaceholder || title}
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="truncate text-sm">{searchPlaceholder || title}</span>
          </button>
          {searchActive && onClearSearch && (
            <button
              type="button"
              onClick={onClearSearch}
              className="h-8 w-8 flex-shrink-0 grid place-items-center rounded-full text-muted-foreground hover:bg-background/60"
              aria-label={t('clear_search')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Right actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {onSearch && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearch}
            className="h-11 w-11"
            aria-label={t('mobile.search')}
          >
            <Search className="h-5 w-5" />
          </Button>
        )}
        {onCompose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCompose}
            className="h-11 w-11 text-primary"
            aria-label={t('mobile.compose')}
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}

        {/* Which account you are reading is otherwise only visible after
            opening the drawer. Last in this group so it sits on the far
            edge — opposite the menu button, and mirrored under RTL because
            the header is laid out with flex rather than fixed sides. */}
        <AccountSwitcher variant="header" />
      </div>
    </header>
  );
}

/**
 * Viewer header for mobile - shows when viewing an email
 */
interface MobileViewerHeaderProps {
  subject?: string;
  onBack: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  className?: string;
}

export function MobileViewerHeader({
  subject,
  onBack,
  onDelete: _onDelete,
  onArchive: _onArchive,
  className,
}: MobileViewerHeaderProps) {
  const t = useTranslations('sidebar');
  const isPaneDesktop = useIsDesktop();
  if (isPaneDesktop) return null;

  return (
    <header
      className={cn(
        "flex items-center justify-between px-2 h-14 border-b border-border bg-background shrink-0",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        className="h-11 w-11"
        aria-label={t('mobile.go_back')}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <h1 className="flex-1 font-medium text-sm truncate px-2 text-center">
        {subject || "(No Subject)"}
      </h1>

      <div className="flex items-center">
        {/* Placeholder for additional actions - kept minimal */}
        <div className="w-10" />
      </div>
    </header>
  );
}
