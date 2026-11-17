import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MoveButtons } from '../move-buttons';

// MO-06: drag-only lists get Move up / Move down.

function List() {
  const [items, setItems] = useState(['Work', 'Home', 'Bills']);
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
  };
  return (
    <ul>
      {items.map((name, index) => (
        <li key={name} data-testid="item">
          {name}
          <MoveButtons index={index} count={items.length} name={name} onMove={move} />
        </li>
      ))}
    </ul>
  );
}

const order = () => screen.getAllByTestId('item').map((li) => li.firstChild!.textContent);

describe('MoveButtons', () => {
  it('moves an item up and down', () => {
    render(<List />);
    fireEvent.click(screen.getAllByTestId('move-down')[0]);
    expect(order()).toEqual(['Home', 'Work', 'Bills']);
  });

  it('disables the button that has nowhere to go', () => {
    const onMove = vi.fn();
    render(<MoveButtons index={0} count={3} name="Work" onMove={onMove} />);
    expect(screen.getByTestId('move-up')).toBeDisabled();
    expect(screen.getByTestId('move-down')).toBeEnabled();
    fireEvent.click(screen.getByTestId('move-down'));
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });

  it('keeps the focus on a working button when the item reaches the top', () => {
    render(<List />);
    const homeUp = screen.getAllByTestId('move-up')[1];
    act(() => homeUp.focus());
    act(() => { fireEvent.click(homeUp); });
    expect(order()).toEqual(['Home', 'Work', 'Bills']);
    expect(screen.getAllByTestId('move-down')[0]).toHaveFocus();
  });

  it('draws nothing for a single item', () => {
    const { container } = render(<MoveButtons index={0} count={1} name="Work" onMove={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
