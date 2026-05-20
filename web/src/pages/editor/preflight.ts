import type { PolicyPreview, ValidationCheck, ValidationReport } from '../../api/types';

type LocaleText = (en: string, zh: string) => string;

interface SubmitPreflightInput {
  validation?: ValidationReport | null;
  policy?: PolicyPreview | null;
  isHotfix: boolean;
  text: LocaleText;
}

export interface SubmitPreflight {
  blockers: ValidationCheck[];
  warnings: ValidationCheck[];
  ready: boolean;
}

export function buildSubmitPreflight({
  validation,
  policy,
  isHotfix,
  text,
}: SubmitPreflightInput): SubmitPreflight {
  const checks = validation?.checks ?? [];
  const reviewerBlocker: ValidationCheck | null = !isHotfix
    && policy != null
    && (policy.suggested ?? []).length === 0
    ? {
        id: 'reviewers',
        label: text('Reviewers', '审批人'),
        severity: 'err',
        detail: text(
          'No eligible reviewers match the current policy. Add another eligible namespace member, or adjust the namespace policy.',
          '当前审批策略下没有可用审批人。请添加另一个符合策略的命名空间成员，或调整命名空间审批策略。',
        ),
      }
    : null;
  const blockers = [
    ...checks.filter((c) => c.severity === 'err'),
    ...(reviewerBlocker ? [reviewerBlocker] : []),
  ];
  const warnings = checks.filter((c) => c.severity === 'warn');
  return {
    blockers,
    warnings,
    ready: validation != null && blockers.length === 0,
  };
}
