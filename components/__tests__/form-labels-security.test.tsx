import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { unnamedFields } from '@/lib/__tests__/helpers/form-labels';
import { AccountSecuritySettings } from '@/components/settings/account-security-settings';
import { useAccountSecurityStore } from '@/stores/account-security-store';
import { useAuthStore } from '@/stores/auth-store';

// Settings > Security: the password, app password, API key and public key
// forms name every field (see form-labels.test.tsx).

describe('security settings fields have labels', () => {
  it('names every field, with each add form open', () => {
    useAuthStore.setState({ isAuthenticated: false, authMode: 'basic', client: null } as never);
    useAccountSecurityStore.setState({
      isStalwart: true, isProbing: false, otpEnabled: false, isSaving: false,
      isLoadingAuth: false, isLoadingPrincipal: false, displayName: 'Ann',
      appPasswords: [], apiKeys: [], publicKeys: [],
    } as never);
    render(<AccountSecuritySettings />);
    // Open every add form there is.
    for (const name of [/app_passwords\.new/, /api_keys\.new/, /public_keys\.add/]) {
      const button = screen.queryAllByRole('button', { name }).at(0);
      if (button) act(() => { fireEvent.click(button); });
    }
    expect(document.querySelectorAll('input, select, textarea').length).toBeGreaterThan(5);
    expect(unnamedFields()).toEqual([]);
  });
});
