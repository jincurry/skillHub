import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill, ClassificationTag } from './Tags';

describe('Tags', () => {
  it('renders StatusPill with published status', () => {
    render(<StatusPill status="published" />);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('renders StatusPill with review status', () => {
    render(<StatusPill status="review" />);
    expect(screen.getByText('审批中')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L1', () => {
    render(<ClassificationTag level="L1" />);
    expect(screen.getByText('L1 公开')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L2', () => {
    render(<ClassificationTag level="L2" />);
    expect(screen.getByText('L2 内部')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L3', () => {
    render(<ClassificationTag level="L3" />);
    expect(screen.getByText('L3 敏感')).toBeInTheDocument();
  });
});
