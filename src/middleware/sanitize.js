// NoSQL-injection guard: removes keys starting with `$` or containing `.` from
function clean(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key]
    } else {
      clean(value[key], depth + 1)
    }
  }
}

export default function sanitize(req, _res, next) {
  clean(req.body)
  clean(req.query)
  clean(req.params)
  next()
}
