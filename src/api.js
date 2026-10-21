export async function api(path, data, method = 'POST') {
 const response = await fetch(`/api/${path}`, { method: data === undefined ? 'GET' : method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
 const result = await response.json()
 if (!response.ok) throw new Error(result.error || 'Request failed')
 return result
}
