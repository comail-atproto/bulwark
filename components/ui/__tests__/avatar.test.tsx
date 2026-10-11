import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Avatar } from '../avatar';

describe('Avatar', () => {
  it('renders initials from full name', () => {
    const { container } = render(<Avatar name="Alice Smith" />);
    expect(container.textContent).toBe('AS');
  });

  it('renders two letters from single-word name', () => {
    const { container } = render(<Avatar name="Alice" />);
    expect(container.textContent).toBe('AL');
  });

  it('renders single letter from email when no name', () => {
    const { container } = render(<Avatar email="bob@example.com" />);
    expect(container.textContent).toBe('B');
  });

  it('renders "?" when no name or email', () => {
    const { container } = render(<Avatar />);
    expect(container.textContent).toBe('?');
  });

  it('produces consistent background color for same input', () => {
    const { container: a } = render(<Avatar name="Alice" />);
    const { container: b } = render(<Avatar name="Alice" />);
    const colorA = (a.firstChild as HTMLElement).style.backgroundColor;
    const colorB = (b.firstChild as HTMLElement).style.backgroundColor;
    expect(colorA).toBe(colorB);
  });
});
