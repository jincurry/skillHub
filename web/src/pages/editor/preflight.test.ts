// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { PolicyPreview, ValidationReport } from '../../api/types';
import { buildSubmitPreflight } from './preflight';

const text = (en: string) => en;

const validation: ValidationReport = {
  skill: 'platform-team/competitive-analysis',
  version: '0.1.0',
  score: 100,
  summary: 'ok',
  checks: [],
};

const policy: PolicyPreview = {
  classification: 'L1',
  mode: 'parallel',
  slaHours: 24,
  slots: [{ Roles: ['owner', 'maintainer'], Count: 1 }],
  suggested: [],
};

describe('buildSubmitPreflight', () => {
  it('blocks regular submissions when the policy has no eligible reviewers', () => {
    const result = buildSubmitPreflight({
      validation,
      policy,
      isHotfix: false,
      text,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      expect.objectContaining({
        id: 'reviewers',
        severity: 'err',
      }),
    ]);
  });

  it('does not add the reviewer blocker for hotfix submissions', () => {
    const result = buildSubmitPreflight({
      validation,
      policy,
      isHotfix: true,
      text,
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('keeps validation errors as blockers and warnings as non-blocking', () => {
    const result = buildSubmitPreflight({
      validation: {
        ...validation,
        checks: [
          { id: 'required', label: 'Required files', severity: 'err' },
          { id: 'readme', label: 'README', severity: 'warn' },
        ],
      },
      policy: {
        ...policy,
        suggested: ['alice'],
      },
      isHotfix: false,
      text,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.map((c) => c.id)).toEqual(['required']);
    expect(result.warnings.map((c) => c.id)).toEqual(['readme']);
  });
});
