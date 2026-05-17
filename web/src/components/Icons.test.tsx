import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconChat, IconCheckCircle, IconXCircle } from './Icons';

describe('Icons', () => {
  it('renders IconChat', () => {
    render(<IconChat size={16} />);
    const svg = screen.getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
  });

  it('renders IconCheckCircle', () => {
    render(<IconCheckCircle size={20} />);
    const svg = screen.getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('renders IconXCircle', () => {
    render(<IconXCircle size={24} />);
    const svg = screen.getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });
});
