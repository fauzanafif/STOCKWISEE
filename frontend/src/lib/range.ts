/** A from–to filter of a number column; either side may be empty. */
export interface Range { min: string; max: string }

/** The request params of a range: name_min / name_max, empty sides left out. */
export const rangeParams = (name: string, r: Range) => ({
  [`${name}_min`]: r.min !== '' ? r.min : undefined,
  [`${name}_max`]: r.max !== '' ? r.max : undefined,
})
