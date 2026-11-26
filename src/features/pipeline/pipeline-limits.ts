/** The most steps one group or embedded document layer holds. */
export const MAX_GROUP_STEPS = 200
/** The most steps a pipeline holds in all, counting those at every depth. */
export const MAX_PIPELINE_STEPS = 1000
/** The most groups and embedded document layers that can sit one inside another. */
export const MAX_NESTING_DEPTH = 8

export const TOO_MANY_STEPS = `A pipeline can have at most ${MAX_PIPELINE_STEPS} steps.`
export const TOO_DEEP = `Groups and embedded document layers can go at most ${MAX_NESTING_DEPTH} deep.`
