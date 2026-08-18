// OnboardingSurface: the full-viewport first-run takeover an onboarding step
// wraps its visible content in. The overlay portals to this document's body
// (the Modal precedent: ancestor stacking contexts cannot leave sticky page
// controls above the mask), and the surface holds `#root` inert for exactly
// its own lifetime — a step that renders null paints nothing and blocks
// nothing, so "should onboarding show right now" stays a plain render
// decision inside the step component.

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './OnboardingSurface.module.css'

/**
 * Render the onboarding takeover chrome (mask + opaque stage) around one
 * step's content and keep the application root inert while mounted.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the body-portaled overlay tree.
 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    appRoot.inert = true
    return () => { appRoot.inert = false }
  }, [])

  return createPortal((
    <div className={css.onboardingOverlay} role="presentation">
      <div className={css.onboardingMask} aria-hidden="true" />
      <div className={css.onboardingStage}>{children}</div>
    </div>
  ), document.body)
}
