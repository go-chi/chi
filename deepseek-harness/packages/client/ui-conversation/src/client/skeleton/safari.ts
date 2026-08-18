/** Safari-specific textarea layout recovery for the conversation composer. */

/** Browser identity fields needed to distinguish Safari from other WebKit-based browsers. */
export interface BrowserIdentity {
  readonly userAgent: string
  readonly vendor: string
}

const ALTERNATE_IOS_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|Brave)(?:\/|\b)/

/**
 * Detect Safari's `Version/... Safari/...` form while excluding known alternate iOS browser tokens.
 * @param identity - Browser user-agent and vendor values.
 * @returns Whether the identity should use the Safari-specific recovery.
 */
export function isSafariBrowser(identity: BrowserIdentity): boolean {
  return identity.vendor === 'Apple Computer, Inc.'
    && /\bVersion\/[\d.]+.*\bSafari\/[\d.]+/.test(identity.userAgent)
    && !ALTERNATE_IOS_BROWSER.test(identity.userAgent)
}

/**
 * Repair Safari's stale native textarea layout and the scrollport auto height it can contaminate.
 * @param input - Composer textarea whose own scrollable overflow must stay zero.
 */
export function repairSafariTextareaLayout(input: HTMLTextAreaElement | null): void {
  if (input === null || input.scrollHeight <= input.clientHeight) return
  const scrollport = input.closest<HTMLElement>('[data-input-scroll]')
  if (scrollport === null) return

  const inputHeight = input.style.height
  input.style.height = `${String(input.clientHeight + 1)}px`
  void input.offsetHeight
  input.style.height = inputHeight
  void input.offsetHeight

  const scrollportHeight = scrollport.style.height
  scrollport.style.height = `${String(scrollport.clientHeight + 1)}px`
  void scrollport.offsetHeight
  scrollport.style.height = scrollportHeight
  void scrollport.offsetHeight
}
