export async function api(path, data, method = 'POST') {
 let response
 try {
  response = await fetch(`/api/${path}`, { method: data === undefined ? 'GET' : method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
 } catch {
  throw new Error('Cannot reach the server. Check your connection and try again.')
 }
 let result
 try {
  result = await response.json()
 } catch {
  throw new Error('The server returned an invalid or empty response. Contact your system administrator to check the API connection.')
 }
 if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Request failed. Please try again.')
 if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The server returned an unexpected response. Contact your system administrator.')
 return result
}
