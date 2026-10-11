import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ResizeHandle } from '../resize-handle';

describe('ResizeHandle', () => {
  it('should render with separator role', () => {
    const { getByRole } = render(
      <ResizeHandle onResize={vi.fn()} />
    );
    const handle = getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  describe('aria value attributes (axe aria-required-attr)', () => {
    it('always exposes aria-valuenow/min/max even without value props', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} />
      );
      const handle = getByRole('separator');
      // A focusable role="separator" is a required-value widget: axe's
      // aria-required-attr flags it if aria-valuenow is missing.
      expect(handle).toHaveAttribute('aria-valuenow');
      expect(handle).toHaveAttribute('aria-valuemin');
      expect(handle).toHaveAttribute('aria-valuemax');
    });

    it('reflects supplied value/valueMin/valueMax as numeric attributes', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} value={320} valueMin={200} valueMax={600} />
      );
      const handle = getByRole('separator');
      expect(handle).toHaveAttribute('aria-valuenow', '320');
      expect(handle).toHaveAttribute('aria-valuemin', '200');
      expect(handle).toHaveAttribute('aria-valuemax', '600');
    });

    it('clamps valuenow into the [min,max] range', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} value={900} valueMin={200} valueMax={600} />
      );
      expect(getByRole('separator')).toHaveAttribute('aria-valuenow', '600');
    });

    it('rounds fractional values so the attribute is an integer', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} value={320.6} valueMin={200} valueMax={600} />
      );
      expect(getByRole('separator')).toHaveAttribute('aria-valuenow', '321');
    });

    it('sets aria-valuetext when provided', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} value={320} valueText="Sidebar 320 pixels" />
      );
      expect(getByRole('separator')).toHaveAttribute('aria-valuetext', 'Sidebar 320 pixels');
    });
  });

  describe('keyboard interaction', () => {
    it('should call onResize with negative delta on ArrowLeft', () => {
      const onResize = vi.fn();
      const onResizeEnd = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={onResize} onResizeEnd={onResizeEnd} />
      );
      const handle = getByRole('separator');
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      expect(onResize).toHaveBeenCalledWith(-10);
      expect(onResizeEnd).toHaveBeenCalled();
    });

    it('should call onResize with positive delta on ArrowRight', () => {
      const onResize = vi.fn();
      const onResizeEnd = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={onResize} onResizeEnd={onResizeEnd} />
      );
      const handle = getByRole('separator');
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      expect(onResize).toHaveBeenCalledWith(10);
      expect(onResizeEnd).toHaveBeenCalled();
    });

    it('should not respond to other keys', () => {
      const onResize = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={onResize} />
      );
      const handle = getByRole('separator');
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      fireEvent.keyDown(handle, { key: 'Enter' });
      fireEvent.keyDown(handle, { key: 'a' });
      expect(onResize).not.toHaveBeenCalled();
    });
  });

  describe('double-click', () => {
    it('should call onDoubleClick when provided', () => {
      const onDoubleClick = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} onDoubleClick={onDoubleClick} />
      );
      const handle = getByRole('separator');
      fireEvent.doubleClick(handle);
      expect(onDoubleClick).toHaveBeenCalledOnce();
    });

    it('should not error when onDoubleClick is not provided', () => {
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} />
      );
      const handle = getByRole('separator');
      expect(() => fireEvent.doubleClick(handle)).not.toThrow();
    });
  });

  describe('mouse drag', () => {
    it('should call onResize during mousemove after mousedown', () => {
      const onResize = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={onResize} />
      );
      const handle = getByRole('separator');

      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 115 });
      expect(onResize).toHaveBeenCalledWith(15);
    });

    it('should call onResizeEnd on mouseup', () => {
      const onResizeEnd = vi.fn();
      const { getByRole } = render(
        <ResizeHandle onResize={vi.fn()} onResizeEnd={onResizeEnd} />
      );
      const handle = getByRole('separator');

      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseUp(document);
      expect(onResizeEnd).toHaveBeenCalledOnce();
    });

    it('should not call onResize on mousemove without mousedown', () => {
      const onResize = vi.fn();
      render(<ResizeHandle onResize={onResize} />);
      fireEvent.mouseMove(document, { clientX: 200 });
      expect(onResize).not.toHaveBeenCalled();
    });
  });
});
