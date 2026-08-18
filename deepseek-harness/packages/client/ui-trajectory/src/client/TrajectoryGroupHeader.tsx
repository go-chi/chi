// TrajectoryGroupHeader: "Message" or "Step N" row with optional description.

import css from './TrajectoryGroupHeader.module.css'

export interface TrajectoryGroupHeaderProps {
  /** Group title (`Message`, `Step 1`, …). */
  title: string
  /** Secondary summary (`49 s`, `2.2 s skill`, …). */
  description?: string
}

/**
 * Render a Message/Step group header inside a turn body.
 * @param props - title and optional description.
 * @returns the group header element.
 */
export function TrajectoryGroupHeader({ title, description }: TrajectoryGroupHeaderProps) {
  return (
    <div className={css.root}>
      <span className={css.title}>{title}</span>
      {description !== undefined && description !== ''
        ? <span className={css.description}>{description}</span>
        : null}
    </div>
  )
}
