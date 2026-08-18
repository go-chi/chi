import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context extends Pick<TimerService, 'interval' | 'timeout' | 'throttle' | 'debounce' | 'setTimeout' | 'setInterval'> {
    timer: TimerService
  }
}

type WithDispose<T> = T & { dispose: () => void }

/** Disposable timer helpers mixed into Cordis contexts. */
export class TimerService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'timer')
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval'])
  }

  /** @deprecated use `ctx.timeout()` instead */
  setTimeout(callback: () => void, delay: number) {
    return this.timeout(callback, delay)
  }

  /** @deprecated use `ctx.interval()` instead */
  setInterval(callback: () => void, delay: number) {
    return this.interval(callback, delay)
  }

  /** Run a callback once, or return a promise that resolves after `delay`. */
  timeout(callback: () => void, delay: number): () => void
  timeout(delay: number): Promise<void>
  timeout(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() : undefined
    const delay = args[0] as number
    if (callback) {
      const dispose = this.ctx.effect(() => {
        const timer = setTimeout(() => {
          dispose()
          callback()
        }, delay)
        return () => clearTimeout(timer)
      }, 'ctx.timeout()')
      return dispose
    } else {
      const { promise, resolve, reject } = Promise.withResolvers<void>()
      const dispose = this.ctx.effect(() => {
        const timer = setTimeout(resolve, delay)
        return () => {
          clearTimeout(timer)
          reject(new Error('Context has been disposed'))
        }
      }, 'ctx.timeout()')
      return promise.finally(dispose)
    }
  }

  /** Run a callback repeatedly, or return an async iterator of ticks. */
  interval(callback: () => void, delay: number): () => void
  interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>
  interval(...args: any[]): any {
    const callback = typeof args[0] === 'function' ? args.shift() : undefined
    const delay = args[0] as number
    if (callback) {
      return this.ctx.effect(() => {
        const timer = setInterval(callback, delay)
        return () => clearInterval(timer)
      }, 'ctx.interval()')
    } else {
      let done: { kind: 'return'; value: any } | { kind: 'throw'; reason: any } | undefined
      let nextTask: PromiseWithResolvers<IteratorResult<void>> | undefined
      const dispose = this.ctx.effect(() => {
        const timer = setInterval(() => {
          nextTask?.resolve({ done: false, value: undefined })
        }, delay)
        return () => {
          clearInterval(timer)
          if (done) return
          done = { kind: 'throw', reason: new Error('Context has been disposed') }
          nextTask?.reject(done.reason)
        }
      }, 'ctx.interval()')
      return {
        next: () => {
          if (!done) return (nextTask = Promise.withResolvers()).promise
          if (done.kind === 'return') return Promise.resolve({ done: true, value: done.value })
          return Promise.reject(done.reason)
        },
        return: (value) => {
          if (!done) done = { kind: 'return', value }
          nextTask?.resolve({ done: true, value })
          dispose()
          return Promise.resolve({ done: true, value })
        },
        throw: (reason) => {
          if (!done) done = { kind: 'throw', reason }
          nextTask?.reject(reason)
          dispose()
          return Promise.resolve({ done: true, value: undefined })
        },
        [Symbol.asyncIterator]() {
          return this
        },
      } satisfies AsyncIterableIterator<void>
    }
  }

  private _schedule(label: string, trigger: (args: any[], isDisposed: boolean) => any, isDisposed = false) {
    let timer: number | NodeJS.Timeout | undefined
    const dispose = this.ctx.effect(() => () => {
      isDisposed = true
      clearTimeout(timer)
    }, label)
    const wrapper: any = (...args: any[]) => {
      clearTimeout(timer)
      timer = trigger(args, isDisposed)
    }
    wrapper.dispose = dispose
    return wrapper
  }

  /** Return a throttled function whose timer is disposed with the current fiber. */
  throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing?: boolean): WithDispose<F> {
    let lastCall = -Infinity
    const execute = (...args: any[]) => {
      lastCall = Date.now()
      callback(...args)
    }
    return this._schedule('ctx.throttle()', (args, isDisposed) => {
      const now = Date.now()
      const remaining = delay - now + lastCall
      if (remaining <= 0) {
        execute(...args)
      } else if (!isDisposed) {
        return setTimeout(execute, remaining, ...args)
      }
    }, noTrailing)
  }

  /** Return a debounced function whose timer is disposed with the current fiber. */
  debounce<F extends (...args: any[]) => void>(callback: F, delay: number): WithDispose<F> {
    return this._schedule('ctx.debounce()', (args, isDisposed) => {
      if (isDisposed) return
      return setTimeout(callback, delay, ...args)
    })
  }
}

export default TimerService
