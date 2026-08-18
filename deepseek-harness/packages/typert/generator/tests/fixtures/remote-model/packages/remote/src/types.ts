/** Input accepted by Goal creation. */
export interface CreateGoalRequest {
  readonly title: string
}

/** Wire-safe Goal creation result. */
export interface CreateGoalResult {
  readonly ref: string
}

/** Input accepted by scoped Goal renaming. */
export interface RenameGoalRequest {
  readonly ref: string
  readonly title: string
}

/** Wire-safe Goal rename result. */
export interface RenameGoalResult {
  readonly renamed: boolean
}
