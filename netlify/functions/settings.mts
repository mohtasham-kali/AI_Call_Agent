import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'settings', consistency: 'strong' })

  if (req.method === 'GET') {
    const pitch = await store.get('global_pitch', { type: 'text' })
    return Response.json({ global_pitch: pitch || '' })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    await store.set('global_pitch', body.global_pitch || '')
    return Response.json({ message: 'Global pitch updated' })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/settings',
  method: ['GET', 'POST'],
}
