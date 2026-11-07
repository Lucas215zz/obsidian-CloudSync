// Stub of Obsidian's requestUrl for Node verification (fetch-based).
export function requestUrl(param: any): Promise<any> {
  return fetch(param.url, {
    method: param.method,
    headers: param.headers,
    body: param.body,
  }).then(async (res) => {
    const ab = await res.arrayBuffer()
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers as any),
      arrayBuffer: ab,
      text: new TextDecoder().decode(ab),
    }
  })
}
