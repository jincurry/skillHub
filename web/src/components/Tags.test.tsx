import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill, ClassificationTag } from './Tags';
import i18n from '../i18n';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Tags', () => {
  it('renders StatusPill with published status', () => {
    render(<StatusPill status="published" />);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('renders StatusPill with review status', () => {
    render(<StatusPill status="review" />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L1', () => {
    render(<ClassificationTag level="L1" />);
    expect(screen.getByText('L1 Public')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L2', () => {
    render(<ClassificationTag level="L2" />);
    expect(screen.getByText('L2 Internal')).toBeInTheDocument();
  });

  it('renders ClassificationTag with L3', () => {
    render(<ClassificationTag level="L3" />);
    expect(screen.getByText('L3 Sensitive')).toBeInTheDocument();
  });

  it('renders localized Chinese labels', async () => {
    await i18n.changeLanguage('zh-CN');

    render(
      <>
        <StatusPill status="review" />
        <ClassificationTag level="L3" />
      </>,
    );

    expect(screen.getByText('审批中')).toBeInTheDocument();
    expect(screen.getByText('L3 敏感')).toBeInTheDocument();
  });
});
