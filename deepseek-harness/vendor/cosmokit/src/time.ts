/** Time constants plus parsing and formatting helpers. */
export namespace Time {
  export const millisecond = 1
  export const second = 1000
  export const minute = second * 60
  export const hour = minute * 60
  export const day = hour * 24
  export const week = day * 7

  let timezoneOffset = new Date().getTimezoneOffset()

  export function setTimezoneOffset(offset: number) {
    timezoneOffset = offset
  }

  export function getTimezoneOffset() {
    return timezoneOffset
  }

  export function getDateNumber(date: number | Date = new Date(), offset?: number) {
    if (typeof date === 'number') date = new Date(date)
    if (offset === undefined) offset = timezoneOffset
    return Math.floor((date.valueOf() / minute - offset) / 1440)
  }

  export function fromDateNumber(value: number, offset?: number) {
    const date = new Date(value * day)
    if (offset === undefined) offset = timezoneOffset
    return new Date(+date + offset * minute)
  }

  const numeric = /\d+(?:\.\d+)?/.source
  const timeRegExp = new RegExp(`^${[
    'w(?:eek(?:s)?)?',
    'd(?:ay(?:s)?)?',
    'h(?:our(?:s)?)?',
    'm(?:in(?:ute)?(?:s)?)?',
    's(?:ec(?:ond)?(?:s)?)?',
  ].map(unit => `(${numeric}${unit})?`).join('')}$`)

  export function parseTime(source: string) {
    const capture = timeRegExp.exec(source)
    if (!capture) return 0
    return (parseFloat(capture[1]) * week || 0)
      + (parseFloat(capture[2]) * day || 0)
      + (parseFloat(capture[3]) * hour || 0)
      + (parseFloat(capture[4]) * minute || 0)
      + (parseFloat(capture[5]) * second || 0)
  }

  export function parseDate(date: string) {
    const parsed = parseTime(date)
    if (parsed) {
      date = Date.now() + parsed as any
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${new Date().toLocaleDateString()}-${date}`
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
      date = `${new Date().getFullYear()}-${date}`
    }
    return date ? new Date(date) : new Date()
  }

  export function format(ms: number) {
    const abs = Math.abs(ms)
    if (abs >= day - hour / 2) {
      return Math.round(ms / day) + 'd'
    } else if (abs >= hour - minute / 2) {
      return Math.round(ms / hour) + 'h'
    } else if (abs >= minute - second / 2) {
      return Math.round(ms / minute) + 'm'
    } else if (abs >= second) {
      return Math.round(ms / second) + 's'
    }
    return ms + 'ms'
  }

  export function toDigits(source: number, length = 2) {
    return source.toString().padStart(length, '0')
  }

  export function template(template: string, time = new Date()) {
    return template
      .replace('yyyy', time.getFullYear().toString())
      .replace('yy', time.getFullYear().toString().slice(2))
      .replace('MM', toDigits(time.getMonth() + 1))
      .replace('dd', toDigits(time.getDate()))
      .replace('hh', toDigits(time.getHours()))
      .replace('mm', toDigits(time.getMinutes()))
      .replace('ss', toDigits(time.getSeconds()))
      .replace('SSS', toDigits(time.getMilliseconds(), 3))
  }
}
