import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const store = getStore({ name: 'contacts', consistency: 'strong' })
  const id = context.params.id

  if (req.method === 'PUT') {
    const existing = await store.get(`contact-${id}`, { type: 'json' }) as any
    if (!existing) {
      return Response.json({ error: 'Contact not found' }, { status: 404 })
    }
    const body = await req.json()
    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      phone_number: body.phone_number ?? existing.phone_number,
      context: body.context ?? existing.context,
    }
    await store.setJSON(`contact-${id}`, updated)
    return Response.json({ message: 'Contact updated successfully' })
  }

  if (req.method === 'DELETE') {
    await store.delete(`contact-${id}`)
    const index = (await store.get('_index', { type: 'json' }) as number[] | null) || []
    const newIndex = index.filter((i: number) => i !== Number(id))
    await store.setJSON('_index', newIndex)
    return Response.json({ message: 'Contact deleted successfully' })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/contacts/:id',
  method: ['PUT', 'DELETE'],
}
