// Reads ?page & ?limit, runs the query, and returns the envelope every list endpoint uses
export async function paginate(model, filter, { page = 1, limit = 10, sort = '-createdAt', populate, select } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10))
  const skip = (safePage - 1) * safeLimit

  let query = model.find(filter).sort(sort).skip(skip).limit(safeLimit)
  if (populate) query = query.populate(populate)
  if (select) query = query.select(select)

  const [items, total] = await Promise.all([query.lean(), model.countDocuments(filter)])

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
      hasNext: safePage * safeLimit < total,
      hasPrev: safePage > 1,
    },
  }
}

// Builds a case-insensitive OR-regex filter across the given fields
export function searchFilter(search, fields) {
  if (!search || !fields?.length) return null
  const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!safe) return null
  const rx = new RegExp(safe, 'i')
  return { $or: fields.map((f) => ({ [f]: rx })) }
}
