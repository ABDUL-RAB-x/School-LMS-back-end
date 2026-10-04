import { waitUntil } from '@vercel/functions'

// Work that may finish after the response is sent (emails, audit rows).
// On Vercel this keeps the function alive until it settles; elsewhere it just runs.
export function inBackground(promise) {
  waitUntil(promise)
  return promise
}
