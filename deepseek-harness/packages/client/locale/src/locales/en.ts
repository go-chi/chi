import type { CommonKey } from './zh.ts'

/** en base dictionary for the common namespace, checked complete against the zh key set. */
export const en = {
  'ok': 'OK',
  'cancel': 'Cancel',
  'close': 'Close',
  'copy': 'Copy',
  'copied': 'Copied',
  'retry': 'Retry',
  'loading': 'Loading…',
  'load.failed': 'Failed to load',
  'submit': 'Submit',
  'submitting': 'Submitting…',
  'next': 'Next',
  'previous': 'Previous',
  'skip': 'Skip',
  'delete': 'Delete',
  'edit': 'Edit',
  'save': 'Save',
  'search': 'Search',
  'more': 'More',
  'collapse': 'Collapse',
  'expand': 'Expand',
  'back': 'Back',
  'unknown': 'Unknown',
  'none': 'None',
  'truncated': 'Truncated',
} satisfies Record<CommonKey, string>
