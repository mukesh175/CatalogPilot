'use client';

export const ONBOARDING_STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'source', label: 'Source' },
  { key: 'worksheet', label: 'Worksheet' },
  { key: 'mapping', label: 'Mapping' },
  { key: 'rules', label: 'Rules' },
  { key: 'preview', label: 'Preview' },
  { key: 'sync', label: 'Sync' },
];

export function StepIndicator({ current }) {
  const currentIndex = ONBOARDING_STEPS.findIndex((step) => step.key === current);

  return (
    <ol className="cp-steps list-unstyled" aria-label={`Setup progress: step ${currentIndex + 1} of ${ONBOARDING_STEPS.length}`}>
      {ONBOARDING_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        return (
          <li
            key={step.key}
            className={`cp-step${state === 'current' ? ' cp-step-current' : ''}${state === 'done' ? ' cp-step-done' : ''}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="cp-step-number" aria-hidden="true">
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span className="d-none d-sm-inline">{step.label}</span>
            {index < ONBOARDING_STEPS.length - 1 ? <span className="cp-step-divider" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
