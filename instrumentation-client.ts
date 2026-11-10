// Older builds stored unlock passphrases here. Keep clearing them at boot.
try {
  window.sessionStorage.removeItem('smime-unlocked-session');
} catch {
  // Storage can be disabled by browser policy.
}

export {};
